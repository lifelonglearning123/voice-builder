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

  // Load + authorise the bot
  const service = createSupabaseServiceClient();
  const { data: bot, error: botError } = await service
    .from('bots')
    .select('owner_user_id, client_stripe_subscription_id')
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

  const stripe = getStripe();

  try {
    // The customer ID is on the subscription. We fetch the sub once to find
    // it. Could be cached on the bot row in a future iteration.
    const sub = await stripe.subscriptions.retrieve(bot.client_stripe_subscription_id);
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    const { origin } = new URL(request.url);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/dashboard`,
    });

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
