import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import {
  handleCheckoutCompleted,
  handleInvoicePaymentFailed,
  handleSubscriptionChange,
  handleSubscriptionDeleted,
} from '@/lib/stripe/webhook-handlers';

// POST /api/webhooks/stripe-connect
//
// Stripe → us, for events on CONNECTED ACCOUNTS (direct-charge mode).
// Configure in Stripe Dashboard → Developers → Webhooks → "Add endpoint",
// select "Events on Connected accounts", point at this URL. The signing
// secret it gives you goes into STRIPE_CONNECT_WEBHOOK_SECRET.
//
// Every event has `event.account = acct_xxx` — the connected account that
// fired the event. We pass that to the shared handlers so all server-side
// Stripe lookups (subscriptions.retrieve etc.) target the right account.
//
// We deliberately do NOT handle account.updated here — that's a platform
// event (the platform owns the Connect account creation) and is already
// routed to /api/webhooks/stripe.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

export async function POST(req: Request) {
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'STRIPE_CONNECT_WEBHOOK_SECRET not set on the server.' },
      { status: 500 },
    );
  }
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Stripe init failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature verification failed.';
    console.error('[stripe-connect webhook] signature verification failed:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Every Connect event has event.account set. Belt-and-braces check.
  const account = event.account;
  if (!account) {
    console.warn(
      `[stripe-connect webhook] ${event.type} (${event.id}) had no event.account; ignoring`,
    );
    return NextResponse.json({ received: true });
  }
  const scope = { stripeAccount: account } as const;

  console.log(
    `[stripe-connect webhook] received ${event.type} (${event.id}) for ${account}`,
  );

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, scope);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(event.data.object as Stripe.Subscription, scope);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, scope);
        break;
      case 'invoice.paid':
        // Renewal succeeded — sub.updated will follow.
        break;
      default:
        break;
    }
  } catch (e) {
    console.error('[stripe-connect webhook] handler failed:', e);
  }

  return NextResponse.json({ received: true });
}
