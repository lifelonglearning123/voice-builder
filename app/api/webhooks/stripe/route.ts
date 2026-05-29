import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { teardownRetellAgent } from '@/lib/retell/teardown';
import { sendPaymentFailedEmail } from '@/lib/email/notifications';

// POST /api/webhooks/stripe
//
// Stripe → us. Receives subscription lifecycle events and syncs the SMB's
// subscription state into vb.bots so the wizard knows whether the bot is
// activatable / still live.
//
// Idempotent — Stripe may retry, and we may also update the same fields
// from the synchronous /api/checkout/return path. Both write the same data.

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
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.paid':
        // Renewal succeeded — sub.updated will follow with status=active.
        break;
      default:
        // Unhandled events are normal; Stripe sends a lot of types.
        break;
    }
  } catch (e) {
    // Log and return 200 anyway — Stripe should not retry indefinitely
    // because of our internal bugs. We'll fix forward.
    console.error('[stripe webhook] handler failed:', e);
  }

  return NextResponse.json({ received: true });
}

/* ---------------------------------------------------------------------------
 * Event handlers
 * ------------------------------------------------------------------------- */

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const botId = stringMetadata(session.metadata, 'bot_id');
  if (!botId) return;

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!subscriptionId) return;

  // Fetch the subscription to get its current status (the session itself
  // only tells us payment was attempted, not the sub status post-trial etc).
  const stripe = getStripe();
  let status = 'active';
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    status = sub.status;
  } catch (e) {
    console.warn('[stripe webhook] could not fetch subscription:', e);
  }

  const service = createSupabaseServiceClient();
  // Capture cancel_at_period_end + current_period_end if we managed to fetch
  // the subscription. Both reset to defaults on a fresh checkout.
  let cancelAtPeriodEnd = false;
  let periodEnd: string | null = null;
  try {
    const stripe2 = getStripe();
    const sub = await stripe2.subscriptions.retrieve(subscriptionId);
    cancelAtPeriodEnd = isCancellationPending(sub);
    periodEnd = subscriptionPeriodEndIso(sub);
  } catch {
    /* keep defaults */
  }

  await service
    .from('bots')
    .update({
      client_stripe_subscription_id: subscriptionId,
      client_subscription_status: status,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: periodEnd,
    })
    .eq('id', botId);

  // Note: welcome email is sent from /api/bots/notify-welcome (called by
  // Step 08 after the deploy completes) — not from this webhook. Payment
  // succeeds before the bot is actually live, so an email here would be
  // premature and would lie ("is live" before the agent exists).
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  // Find which bot this invoice belongs to. Invoice has subscription_id but
  // we need to read the subscription's metadata to get bot_id.
  const subId =
    typeof (invoice as unknown as { subscription?: string | null }).subscription ===
    'string'
      ? ((invoice as unknown as { subscription?: string }).subscription as string)
      : null;
  if (!subId) return;

  const stripe = getStripe();
  let botId: string | null = null;
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    botId = stringMetadata(sub.metadata, 'bot_id');
  } catch (e) {
    console.warn('[stripe webhook] could not retrieve sub for failed invoice:', e);
    return;
  }
  if (!botId) return;

  await sendPaymentFailedIfPossible(botId, invoice).catch((e) =>
    console.error('[stripe webhook] payment-failed email failed:', e),
  );
}

async function sendPaymentFailedIfPossible(
  botId: string,
  _invoice: Stripe.Invoice,
): Promise<void> {
  const service = createSupabaseServiceClient();
  const { data: bot } = await service
    .from('bots')
    .select('id, agency_id, owner_user_id, draft')
    .eq('id', botId)
    .single();
  if (!bot?.owner_user_id) return;

  const [{ data: user }, { data: agency }] = await Promise.all([
    service.auth.admin.getUserById(bot.owner_user_id),
    service
      .from('agencies')
      .select('from_email, from_name, brand_color, custom_domain, ghl_location_id, ghl_api_token')
      .eq('id', bot.agency_id)
      .single(),
  ]);
  if (!user?.user?.email || !agency?.from_email || !agency?.from_name) return;

  const draft = (bot.draft as { business_name?: string } | null) ?? null;
  // Build the manage-billing URL using the agency's custom domain if
  // available, otherwise fall back to the platform's default.
  const baseUrl = agency.custom_domain
    ? `https://${agency.custom_domain}`
    : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  await sendPaymentFailedEmail({
    to: user.user.email,
    agency: {
      from_email: agency.from_email,
      from_name: agency.from_name,
      brand_color: agency.brand_color ?? null,
      ghl_location_id: agency.ghl_location_id ?? null,
      ghl_api_token: agency.ghl_api_token ?? null,
    },
    businessName: draft?.business_name || 'your AI receptionist',
    manageBillingUrl: `${baseUrl}/dashboard`,
  });
}

async function handleSubscriptionChange(sub: Stripe.Subscription): Promise<void> {
  // Defend against out-of-order webhooks: when an SMB clicks cancel/uncancel
  // in quick succession the events can race in our async handler. Re-fetching
  // the subscription from Stripe right now means every handler converges on
  // the same latest state — order no longer matters, end state is correct.
  let latest: Stripe.Subscription = sub;
  try {
    const stripe = getStripe();
    latest = await stripe.subscriptions.retrieve(sub.id);
  } catch (e) {
    console.warn('[stripe webhook] subscription re-fetch failed, using payload:', e);
  }

  // If the latest state says canceled, defer to the deletion handler — same
  // teardown logic applies.
  if (latest.status === 'canceled') {
    await handleSubscriptionDeleted(latest);
    return;
  }

  // When the SMB cancels at period end, status stays 'active' and either
  // cancel_at_period_end flips to true (legacy) or cancel_at gets a timestamp
  // (newer portal-initiated cancels). Either way, we keep the bot running and
  // record the pending cancellation so the dashboard can show the date.
  const periodEnd = subscriptionPeriodEndIso(latest);
  const payload = {
    client_subscription_status: latest.status,
    cancel_at_period_end: isCancellationPending(latest),
    current_period_end: periodEnd,
  };

  const service = createSupabaseServiceClient();
  const botId = stringMetadata(latest.metadata, 'bot_id');
  if (!botId) {
    // Fallback: find the bot by subscription_id (older subs may pre-date
    // metadata stamping).
    await service.from('bots').update(payload).eq('client_stripe_subscription_id', latest.id);
    return;
  }

  await service
    .from('bots')
    .update({ ...payload, client_stripe_subscription_id: latest.id })
    .eq('id', botId);
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const service = createSupabaseServiceClient();
  const botId = stringMetadata(sub.metadata, 'bot_id');

  // Find the bot first so we know which Retell resources to tear down.
  const { data: bot } = botId
    ? await service
        .from('bots')
        .select('id, agent_id, llm_id')
        .eq('id', botId)
        .maybeSingle()
    : await service
        .from('bots')
        .select('id, agent_id, llm_id')
        .eq('client_stripe_subscription_id', sub.id)
        .maybeSingle();

  if (!bot) {
    console.warn('[stripe webhook] subscription.deleted with no matching bot', sub.id);
    return;
  }

  // Tear down the Retell agent + LLM so the SMB can't keep using paid
  // infrastructure after cancellation. Done before the DB update so a
  // failure here doesn't leave a "phantom archived" bot still answering
  // calls — though teardown failures only log, they don't throw.
  await teardownRetellAgent({
    agent_id: bot.agent_id,
    llm_id: bot.llm_id,
  });

  await service
    .from('bots')
    .update({
      client_subscription_status: 'canceled',
      status: 'archived',
      // Clear the IDs so re-activation (if ever) creates fresh resources.
      agent_id: null,
      llm_id: null,
      // Reset pending-cancellation fields — the cancellation is now final.
      cancel_at_period_end: false,
      current_period_end: null,
    })
    .eq('id', bot.id);
}

async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  // Stripe sends this whenever a Connect account changes — KYC submitted,
  // charges enabled, etc. Sync our `stripe_connect_onboarding_complete`
  // flag so the agency settings page reflects the latest status without
  // waiting for the user to click "refresh".
  const onboardingComplete = !!account.details_submitted && !!account.charges_enabled;
  const service = createSupabaseServiceClient();
  await service
    .from('agencies')
    .update({ stripe_connect_onboarding_complete: onboardingComplete })
    .eq('stripe_connect_account_id', account.id);
}

function stringMetadata(
  meta: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = meta?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Stripe transitioned from the boolean `cancel_at_period_end` to the timestamped
// `cancel_at` field when a scheduled cancellation is set via the customer portal
// in newer API versions. The boolean stays `false` even when a cancellation IS
// pending, so checking it alone misses portal-initiated cancels. Treat either
// signal as "cancellation pending" while the subscription is still active.
function isCancellationPending(sub: Stripe.Subscription): boolean {
  if (sub.cancel_at_period_end) return true;
  const cancelAt = (sub as unknown as { cancel_at?: number | null }).cancel_at;
  return typeof cancelAt === 'number' && cancelAt > 0 && sub.status === 'active';
}

function subscriptionPeriodEndIso(sub: Stripe.Subscription): string | null {
  // Stripe sometimes serialises subscription.current_period_end on top-level,
  // sometimes only on the first item. Prefer top-level when present.
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  if (typeof top === 'number' && top > 0) {
    return new Date(top * 1000).toISOString();
  }
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  if (typeof itemEnd === 'number' && itemEnd > 0) {
    return new Date(itemEnd * 1000).toISOString();
  }
  return null;
}
