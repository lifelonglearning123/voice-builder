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
// specific bot. Two routing modes, picked per-agency:
//
//   - DIRECT CHARGES (agency.use_direct_charges = true, onboarding complete):
//     The session is created on the connected account (`stripeAccount` opt).
//     The agency is the merchant of record. The agency's Connect account
//     pays the Stripe processing fee out of its own revenue and refunds
//     debit it naturally. Platform takes no application fee.
//
//   - DESTINATION CHARGES (everyone else, including legacy subs):
//     Original behaviour. Customer pays the platform Stripe; full amount
//     transferred to the connected account when one exists.
//
// Pricing: per-agency. Reads `client_price_pence` / `client_currency` from
// the agency row. In direct-charge mode we use `product_data` inline so we
// don't have to provision a Product on each connected account at onboarding
// time — Stripe creates an ephemeral product on the fly. In destination
// mode we still reference the shared platform Product via `STRIPE_PRODUCT_ID`.
//
// Promo codes: optional, agency-scoped. In destination mode, agency
// scoping is enforced via `metadata.agency_id` on the coupon. In direct
// mode the coupon lives on the connected account, so the Connect-account
// boundary is the scope — no extra metadata check needed.
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

  // Load the agency to determine routing mode and per-agency pricing.
  const { data: agency } = await service
    .from('agencies')
    .select(
      'id, name, stripe_connect_account_id, stripe_connect_onboarding_complete, use_direct_charges, client_price_pence, client_currency',
    )
    .eq('id', bot.agency_id)
    .single();
  if (!agency) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  // Mode selection. Both modes require Connect to be set up; direct mode
  // additionally requires the feature flag. When neither is true, charge
  // goes straight to the platform (used for Macaws itself and any agency
  // that hasn't onboarded Connect yet).
  const connectReady =
    !!agency.stripe_connect_account_id && agency.stripe_connect_onboarding_complete;
  const useDirect = connectReady && agency.use_direct_charges;
  const useDestination = connectReady && !agency.use_direct_charges;

  // Direct mode creates Stripe objects ON the connected account by passing
  // this as the second arg to every Stripe API call.
  const stripeRequestOptions: { stripeAccount?: string } | undefined = useDirect
    ? { stripeAccount: agency.stripe_connect_account_id! }
    : undefined;

  const stripe = getStripe();
  const { origin } = new URL(request.url);

  // Per-agency price with platform fallback (£99/mo). Stripe expects the
  // currency lowercase.
  const unitAmount = agency.client_price_pence ?? 9900;
  const currency = (agency.client_currency ?? 'GBP').toLowerCase();

  // Optional promo code. Lookup is scoped to wherever the coupons live:
  //   - Direct mode → on the connected account (Connect-account isolation
  //     means we don't need to re-check agency_id metadata; only that
  //     agency's codes can show up here).
  //   - Destination / platform mode → on the platform, and we still enforce
  //     `metadata.agency_id` so codes can't leak across agencies that share
  //     the platform Stripe.
  let promotionCodeId: string | null = null;
  const rawPromo = body.promo_code?.trim();
  if (rawPromo) {
    try {
      const codes = await stripe.promotionCodes.list(
        {
          code: rawPromo,
          active: true,
          // SDK nests the coupon under `promotion.coupon`.
          expand: ['data.promotion.coupon'],
          limit: 1,
        },
        stripeRequestOptions,
      );
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
      // Only enforce metadata-based agency scoping in destination/platform
      // mode. Direct mode is already isolated by the Connect account boundary.
      if (!useDirect) {
        const couponAgencyId =
          (rawCoupon.metadata as Record<string, string> | null | undefined)?.agency_id ?? null;
        if (couponAgencyId !== agency.id) {
          return NextResponse.json(
            { error: 'This promo code isn’t valid for this workspace.' },
            { status: 400 },
          );
        }
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

  // Product source differs by mode:
  //   - Direct mode: inline product_data — Stripe creates an ephemeral
  //     product on the connected account so we never have to provision a
  //     Stripe Product per agency.
  //   - Destination/platform mode: keep referencing the shared platform
  //     Product via STRIPE_PRODUCT_ID for backwards compat.
  const priceDataCommon = {
    currency,
    recurring: { interval: 'month' as const },
    unit_amount: unitAmount,
  };
  let priceData:
    | (typeof priceDataCommon & { product: string })
    | (typeof priceDataCommon & { product_data: { name: string } });
  if (useDirect) {
    priceData = {
      ...priceDataCommon,
      product_data: { name: 'Voice Builder receptionist' },
    };
  } else {
    const productId = process.env.STRIPE_PRODUCT_ID;
    if (!productId) {
      return NextResponse.json(
        { error: 'STRIPE_PRODUCT_ID is not configured on the server.' },
        { status: 500 },
      );
    }
    priceData = { ...priceDataCommon, product: productId };
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{ quantity: 1, price_data: priceData }],
        customer_email: user.email ?? undefined,
        // Direct-charge sessions live on the connected account, but Stripe
        // Link saved cards live on the platform. If a customer has Link
        // cards on file under the same email, Checkout dutifully offers
        // them — then fails with "An unknown error occurred" when the
        // customer clicks Subscribe, because a platform-scoped Link
        // PaymentMethod can't be charged through a connected account.
        //
        // Restricting payment_method_types to ['card'] disables the Link
        // wallet integration entirely; the customer enters a fresh card
        // which gets attached to a new Customer on the connected account
        // and works as expected. Apple Pay / Google Pay still work — they
        // fall under 'card', not 'link'.
        //
        // Destination-mode sessions don't have this problem (the session
        // lives on the platform Stripe, same account as the Link wallet),
        // so we leave that path alone — Link there is a nice convenience.
        ...(useDirect ? { payment_method_types: ['card' as const] } : {}),
        // Metadata flows to the Subscription too, via subscription_data below.
        // In direct mode the session, customer and subscription all live on
        // the connected account — but metadata is platform-neutral and the
        // webhook reads it the same way either way.
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
          // Destination mode only: route funds to the agency's Connect
          // account with 0% platform fee. on_behalf_of makes the connected
          // account the merchant of record on receipts/statement descriptors.
          // In direct mode none of this applies — the connected account
          // IS the merchant because the session itself lives on it.
          ...(useDestination
            ? {
                transfer_data: {
                  destination: agency.stripe_connect_account_id!,
                },
                application_fee_percent: 0,
                on_behalf_of: agency.stripe_connect_account_id!,
              }
            : {}),
        },
        // Apply the validated promo (if any). Stripe rejects discounts +
        // allow_promotion_codes together; we keep allow_promotion_codes off
        // (default) so only server-validated codes can apply.
        ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : {}),
        // In direct mode the session lives on the connected account, so the
        // return handler needs to know which account to scope its retrieve
        // call to. We tack the account id onto the URL — Stripe doesn't pass
        // it back automatically.
        success_url: useDirect
          ? `${origin}/api/checkout/return?session_id={CHECKOUT_SESSION_ID}&account=${agency.stripe_connect_account_id!}`
          : `${origin}/api/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/bots/new/6?checkout=cancelled`,
      },
      stripeRequestOptions,
    );

    if (!session.url) {
      return NextResponse.json(
        { error: 'Stripe did not return a checkout URL' },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    // Surface the underlying Stripe error to the caller so the wizard
    // shows something actionable instead of a generic "try again" wall.
    // Stripe errors carry both `message` (human-readable) and `code` /
    // `decline_code` / `param` — we expose message + code for now since
    // "An unknown error occurred" in the UI was making debugging impossible.
    console.error('[checkout/create-session] failed:', e, {
      bot_id: bot.id,
      agency_id: agency.id,
      use_direct: useDirect,
      use_destination: useDestination,
      destination_account: agency.stripe_connect_account_id,
    });
    const stripeMessage =
      e instanceof Error ? e.message : 'Unknown error from Stripe.';
    const stripeCode = (e as { code?: string } | null)?.code;
    return NextResponse.json(
      {
        error: stripeCode
          ? `Checkout failed (${stripeCode}): ${stripeMessage}`
          : `Checkout failed: ${stripeMessage}`,
      },
      { status: 502 },
    );
  }
}
