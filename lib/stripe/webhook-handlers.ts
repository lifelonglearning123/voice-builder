// Shared Stripe webhook handlers. Used by both:
//   - /api/webhooks/stripe         — platform events (no stripeAccount)
//   - /api/webhooks/stripe-connect — Connect events (event.account is set,
//                                    passed to every Stripe API call)
//
// In direct-charge mode the customer / subscription / invoice all live on
// a connected account; retrieving them server-side requires the
// `stripeAccount` option. By parameterising the handlers on that option we
// can keep one set of handlers across both modes — the DB writes are
// identical, only the Stripe-side scope differs.

import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { teardownRetellAgent } from '@/lib/retell/teardown';
import { sendPaymentFailedEmail } from '@/lib/email/notifications';

/** When set, every Stripe call inside these handlers targets the connected
 *  account. Pass `event.account` from the Connect webhook. Leave undefined
 *  for platform webhooks. */
export type StripeAccountScope = { stripeAccount: string } | undefined;

export async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  scope: StripeAccountScope,
): Promise<void> {
  const botId = stringMetadata(session.metadata, 'bot_id');
  if (!botId) return;

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!subscriptionId) return;

  const stripe = getStripe();
  let status = 'active';
  let cancelAtPeriodEnd = false;
  let periodEnd: string | null = null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, undefined, scope);
    status = sub.status;
    cancelAtPeriodEnd = isCancellationPending(sub);
    periodEnd = subscriptionPeriodEndIso(sub);
  } catch (e) {
    console.warn('[stripe webhook] could not fetch subscription:', e);
  }

  const service = createSupabaseServiceClient();
  await service
    .from('bots')
    .update({
      client_stripe_subscription_id: subscriptionId,
      client_subscription_status: status,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: periodEnd,
    })
    .eq('id', botId);

  // Welcome email is sent from /api/bots/notify-welcome (called by Step 08
  // after the deploy completes), not from this webhook. Payment succeeds
  // before the bot is actually live, so an email here would be premature.
}

export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  scope: StripeAccountScope,
): Promise<void> {
  const subId =
    typeof (invoice as unknown as { subscription?: string | null }).subscription === 'string'
      ? ((invoice as unknown as { subscription?: string }).subscription as string)
      : null;
  if (!subId) return;

  const stripe = getStripe();
  let botId: string | null = null;
  try {
    const sub = await stripe.subscriptions.retrieve(subId, undefined, scope);
    botId = stringMetadata(sub.metadata, 'bot_id');
  } catch (e) {
    console.warn('[stripe webhook] could not retrieve sub for failed invoice:', e);
    return;
  }
  if (!botId) return;

  await sendPaymentFailedIfPossible(botId).catch((e) =>
    console.error('[stripe webhook] payment-failed email failed:', e),
  );
}

async function sendPaymentFailedIfPossible(botId: string): Promise<void> {
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

export async function handleSubscriptionChange(
  sub: Stripe.Subscription,
  scope: StripeAccountScope,
): Promise<void> {
  // Defend against out-of-order webhooks by re-fetching the latest state.
  let latest: Stripe.Subscription = sub;
  try {
    const stripe = getStripe();
    latest = await stripe.subscriptions.retrieve(sub.id, undefined, scope);
  } catch (e) {
    console.warn('[stripe webhook] subscription re-fetch failed, using payload:', e);
  }

  if (latest.status === 'canceled') {
    await handleSubscriptionDeleted(latest);
    return;
  }

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

export async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const service = createSupabaseServiceClient();
  const botId = stringMetadata(sub.metadata, 'bot_id');

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

  await teardownRetellAgent({ agent_id: bot.agent_id, llm_id: bot.llm_id });

  await service
    .from('bots')
    .update({
      client_subscription_status: 'canceled',
      status: 'archived',
      agent_id: null,
      llm_id: null,
      cancel_at_period_end: false,
      current_period_end: null,
    })
    .eq('id', bot.id);
}

export async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  // Connect account changed (KYC submitted, charges enabled). Sync the DB
  // flag so the settings page reflects the latest state.
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

function isCancellationPending(sub: Stripe.Subscription): boolean {
  if (sub.cancel_at_period_end) return true;
  const cancelAt = (sub as unknown as { cancel_at?: number | null }).cancel_at;
  return typeof cancelAt === 'number' && cancelAt > 0 && sub.status === 'active';
}

function subscriptionPeriodEndIso(sub: Stripe.Subscription): string | null {
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
