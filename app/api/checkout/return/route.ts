import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// GET /api/checkout/return?session_id=cs_…&account=acct_…
//
// Stripe redirects here after a successful Checkout. We:
//   1. Retrieve the session — scoped to the connected account when the
//      session was created there (direct-charge mode)
//   2. Verify it's paid + has a subscription
//   3. Update the bot's subscription state in our DB (defensive — the
//      webhook should have done this too, but redirect-time updates avoid
//      a race where the user lands on /bots/new/6 before the webhook fires)
//   4. Redirect back to the wizard
//
// For direct-charge sessions the success_url is appended with `&account=`
// containing the connected account id at session-creation time. That tells
// us to retrieve the session via stripeAccount; otherwise we fall back to
// platform retrieval. If neither works we surface a clear error rather than
// silently swallowing the session.

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  const explicitAccount = searchParams.get('account');

  if (!sessionId) {
    return NextResponse.redirect(`${origin}/bots/new/6?checkout=missing_session`);
  }

  const stripe = getStripe();

  try {
    const session = explicitAccount
      ? await stripe.checkout.sessions.retrieve(
          sessionId,
          { expand: ['subscription'] },
          { stripeAccount: explicitAccount },
        )
      : await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ['subscription'],
        });

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return NextResponse.redirect(`${origin}/bots/new/6?checkout=not_paid`);
    }

    const botId =
      typeof session.metadata?.bot_id === 'string' ? session.metadata.bot_id : null;
    if (!botId) {
      console.error('[checkout/return] no bot_id in session metadata:', sessionId);
      return NextResponse.redirect(`${origin}/bots/new/6?checkout=metadata_missing`);
    }

    let subscriptionId: string | null = null;
    let subscriptionStatus = 'active';
    if (typeof session.subscription === 'string') {
      subscriptionId = session.subscription;
    } else if (session.subscription) {
      subscriptionId = session.subscription.id;
      subscriptionStatus = session.subscription.status;
    }

    // Update the bot row.
    const service = createSupabaseServiceClient();
    await service
      .from('bots')
      .update({
        client_stripe_subscription_id: subscriptionId,
        client_subscription_status: subscriptionStatus,
      })
      .eq('id', botId);

    return NextResponse.redirect(`${origin}/bots/new/6?checkout=success`);
  } catch (e) {
    console.error('[checkout/return] failed:', e);
    return NextResponse.redirect(`${origin}/bots/new/6?checkout=error`);
  }
}
