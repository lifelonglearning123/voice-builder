import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import {
  handleAccountUpdated,
  handleCheckoutCompleted,
  handleInvoicePaymentFailed,
  handleSubscriptionChange,
  handleSubscriptionDeleted,
} from '@/lib/stripe/webhook-handlers';

// POST /api/webhooks/stripe
//
// Stripe → us. Receives PLATFORM events:
//   - Destination-charge subscription lifecycle (events fire on the
//     platform account, no event.account)
//   - account.updated for Connect accounts we own (also no event.account
//     because the platform owns the account creation flow)
//
// Direct-charge events arrive on a DIFFERENT endpoint:
// /api/webhooks/stripe-connect. Don't merge the two without separating
// their webhook secrets; mixing platform and Connect signatures on a single
// endpoint is a footgun in Stripe's dashboard config.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET not set on the server.' },
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
    console.error('[stripe webhook] signature verification failed:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  console.log(`[stripe webhook] received ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, undefined);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(event.data.object as Stripe.Subscription, undefined);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, undefined);
        break;
      case 'invoice.paid':
        // Renewal succeeded — sub.updated will follow with status=active.
        break;
      default:
        break;
    }
  } catch (e) {
    // Log and return 200 anyway — Stripe shouldn't retry indefinitely for
    // our internal bugs. We'll fix forward.
    console.error('[stripe webhook] handler failed:', e);
  }

  return NextResponse.json({ received: true });
}
