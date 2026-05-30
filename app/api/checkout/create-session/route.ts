import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// POST /api/checkout/create-session
// Body: { bot_id: string, promo_code?: string }
//
// Creates a Stripe Checkout Session for a recurring subscription tied to a
// specific bot. Routes the funds via Stripe Connect when the bot's agency
// has onboarded (other agencies); charges direct to platform for Macaws.
//
// Pricing: per-agency. Reads `client_price_pence` / `client_currency` from
// the agency row and builds `price_data` inline against `STRIPE_PRODUCT_ID`.
// Falls back to 9900 pence / GBP when the agency hasn't set a price.
//
// Promo codes: optional, agency-scoped. The coupon backing the promo code
// must have `metadata.agency_id` matching this bot's agency, otherwise the
// request is rejected. Stripe's free-form promo-code box on Checkout is
// disabled (default) so cross-agency codes can't leak in via the UI.
//
// Returns: { url: string } — the Checkout URL to redirect the browser to.

export const runtime = 'nodejs';

interface CreateBody {
  bot_id?: string;
  promo_code?: string;
}

export async function POST(request: Request) {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const botId = body.bot_id?.trim();
  if (!botId) {
    return NextResponse.json({ error: 'bot_id is required' }, { status: 400 });
  }

  const productId = process.env.STRIPE_PRODUCT_ID;
  if (!productId) {
    return NextResponse.json(
      { error: 'STRIPE_PRODUCT_ID is not configured on the server.' },
      { status: 500 },
    );
  }

  // Authenticate the user
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // Load the bot via service client (we'll enforce ownership ourselves).
  const service = createSupabaseServiceClient();
  const { data: bot, error: botError } = await service
    .from('bots')
    .select('id, agency_id, owner_user_id, client_subscription_status')
    .eq('id', botId)
    .single();
  if (botError || !bot) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  }
  if (bot.owner_user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised for this bot' }, { status: 403 });
  }

  // If already active, no need for a new checkout.
  if (
    bot.client_subscription_status === 'active' ||
    bot.client_subscription_status === 'trialing'
  ) {
    return NextResponse.json(
      { error: 'Subscription is already active for this bot.' },
      { status: 409 },
    );
  }

  // Load the agency to determine routing (Connect vs platform direct) and
  // per-agency pricing.
  const { data: agency } = await service
    .from('agencies')
    .select(
      'id, name, stripe_connect_account_id, stripe_connect_onboarding_complete, client_price_pence, client_currency',
    )
    .eq('id', bot.agency_id)
    .single();
  if (!agency) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  const useConnect =
    !!agency.stripe_connect_account_id && agency.stripe_connect_onboarding_complete;

  const stripe = getStripe();
  const { origin } = new URL(request.url);

  // Per-agency price with platform fallback (£99/mo). Stripe expects the
  // currency lowercase.
  const unitAmount = agency.client_price_pence ?? 9900;
  const currency = (agency.client_currency ?? 'GBP').toLowerCase();

  // Optional promo code — must be scoped to this agency via the backing
  // coupon's `metadata.agency_id`. We resolve the promotion code on Stripe
  // first so an invalid / cross-agency code is rejected before we ever open
  // a Checkout session.
  let promotionCodeId: string | null = null;
  const rawPromo = body.promo_code?.trim();
  if (rawPromo) {
    try {
      const codes = await stripe.promotionCodes.list({
        code: rawPromo,
        active: true,
        // SDK nests the coupon under `promotion.coupon`.
        expand: ['data.promotion.coupon'],
        limit: 1,
      });
      const pc = codes.data[0];
      if (!pc) {
        return NextResponse.json(
          { error: 'Promo code not found or expired.' },
          { status: 400 },
        );
      }
      const rawCoupon = pc.promotion.coupon;
      // Expanded coupon should be an object; reject if the SDK gave us a
      // string id or null (means we couldn't read the metadata).
      if (!rawCoupon || typeof rawCoupon === 'string') {
        return NextResponse.json(
          { error: 'Promo code is misconfigured. Please contact support.' },
          { status: 400 },
        );
      }
      const couponAgencyId =
        (rawCoupon.metadata as Record<string, string> | null | undefined)?.agency_id ?? null;
      if (couponAgencyId !== agency.id) {
        return NextResponse.json(
          { error: 'This promo code isn’t valid for this workspace.' },
          { status: 400 },
        );
      }
      promotionCodeId = pc.id;
    } catch (e) {
      console.error('[checkout/create-session] promo lookup failed:', e);
      return NextResponse.json(
        { error: 'Couldn’t validate the promo code. Please try again.' },
        { status: 502 },
      );
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      // Inline price_data — per-agency unit_amount + currency on a shared
      // platform Product. No need to maintain a Stripe Price per agency;
      // agencies edit their price via /dashboard/settings and it takes
      // effect on the next checkout.
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            product: productId,
            recurring: { interval: 'month' },
            unit_amount: unitAmount,
          },
        },
      ],
      customer_email: user.email ?? undefined,
      // Metadata flows to the Subscription too, via subscription_data below.
      metadata: {
        bot_id: bot.id,
        agency_id: agency.id,
        user_id: user.id,
      },
      subscription_data: {
        metadata: {
          bot_id: bot.id,
          agency_id: agency.id,
          user_id: user.id,
        },
        // Connect routing: send funds to the agency's Connect account, no
        // platform fee. When agency has no Connect account (Macaws), money
        // stays with the platform Stripe.
        ...(useConnect
          ? {
              transfer_data: {
                destination: agency.stripe_connect_account_id!,
              },
              application_fee_percent: 0,
            }
          : {}),
      },
      // Apply the validated agency-scoped promo (if any). Stripe rejects the
      // combination of `discounts` + `allow_promotion_codes`, so we omit the
      // latter — its default is false, meaning the free-form promo box is
      // hidden on Checkout. Cross-agency leak is impossible because Stripe's
      // own UI no longer accepts codes; only the server-validated `promo_code`
      // request param can apply a discount.
      ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : {}),
      success_url: `${origin}/api/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/bots/new/10?checkout=cancelled`,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: 'Stripe did not return a checkout URL' },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[checkout/create-session] failed:', e);
    return NextResponse.json(
      { error: 'Couldn’t create checkout session. Please try again.' },
      { status: 502 },
    );
  }
}
