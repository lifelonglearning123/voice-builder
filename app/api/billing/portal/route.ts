import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// POST /api/billing/portal
// Body: { bot_id: string }
//
// Generates a Stripe-hosted Customer Portal session for the SMB to manage
// their subscription (update card, cancel, view invoices). Returns the
// portal URL — the client redirects the browser to it.
//
// Customer Portal must be configured once in Stripe Dashboard:
//   Test mode → Settings → Billing → Customer portal → enable + save.
// We don't need to do that programmatically.

export const runtime = 'nodejs';

interface PortalBody {
  bot_id?: string;
}

export async function POST(request: Request) {
  let body: PortalBody;
  try {
    body = (await request.json()) as PortalBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const botId = body.bot_id?.trim();
  if (!botId) {
    return NextResponse.json({ error: 'bot_id is required' }, { status: 400 });
  }

  // Authenticate
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // Load + authorise the bot, then resolve the agency so we know whether
  // the subscription lives on the platform Stripe or on a connected account
  // (direct-charge mode). The customer portal must be opened on whichever
  // account owns the customer.
  const service = createSupabaseServiceClient();
  const { data: bot, error: botError } = await service
    .from('bots')
    .select('owner_user_id, agency_id, client_stripe_subscription_id')
    .eq('id', botId)
    .single();
  if (botError || !bot) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  }
  if (bot.owner_user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
  }
  if (!bot.client_stripe_subscription_id) {
    return NextResponse.json(
      { error: 'No active subscription found for this bot.' },
      { status: 400 },
    );
  }

  const { data: agency } = await service
    .from('agencies')
    .select('stripe_connect_account_id, stripe_connect_onboarding_complete, use_direct_charges')
    .eq('id', bot.agency_id)
    .single();
  const useDirect =
    !!agency?.use_direct_charges &&
    !!agency.stripe_connect_account_id &&
    !!agency.stripe_connect_onboarding_complete;
  const stripeRequestOptions = useDirect
    ? { stripeAccount: agency!.stripe_connect_account_id! }
    : undefined;

  const stripe = getStripe();

  try {
    // The customer ID is on the subscription. We fetch the sub once to find
    // it — same scope as the subscription itself.
    const sub = await stripe.subscriptions.retrieve(
      bot.client_stripe_subscription_id,
      undefined,
      stripeRequestOptions,
    );
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    const { origin } = new URL(request.url);
    const session = await stripe.billingPortal.sessions.create(
      {
        customer: customerId,
        return_url: `${origin}/dashboard`,
      },
      stripeRequestOptions,
    );

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[billing/portal] failed:', e);
    return NextResponse.json(
      {
        error:
          'Couldn’t open the billing portal. Please try again or contact support.',
      },
      { status: 502 },
    );
  }
}
