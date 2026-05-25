import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// POST /api/checkout/create-session
// Body: { bot_id: string }
//
// Creates a Stripe Checkout Session for a £99/mo subscription tied to a
// specific bot. Routes the funds via Stripe Connect when the bot's agency
// has onboarded (other agencies); charges direct to platform for Macaws.
//
// Returns: { url: string } — the Checkout URL to redirect the browser to.

export const runtime = 'nodejs';

interface CreateBody {
  bot_id?: string;
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

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json(
      { error: 'STRIPE_PRICE_ID is not configured on the server.' },
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

  // Load the agency to determine routing (Connect vs platform direct).
  const { data: agency } = await service
    .from('agencies')
    .select('id, name, stripe_connect_account_id, stripe_connect_onboarding_complete')
    .eq('id', bot.agency_id)
    .single();
  if (!agency) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  const useConnect =
    !!agency.stripe_connect_account_id && agency.stripe_connect_onboarding_complete;

  const stripe = getStripe();
  const { origin } = new URL(request.url);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
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
      success_url: `${origin}/api/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/bots/new/10?checkout=cancelled`,
      allow_promotion_codes: true,
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
