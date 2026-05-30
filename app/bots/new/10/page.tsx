'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { compileBot } from '@/src/compile/compileBot.ts';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { Bot } from '@/src/compile/types.ts';

type ActivateState =
  | { kind: 'idle' }
  | { kind: 'deploying' }
  | { kind: 'linking'; agent_id: string }
  | { kind: 'done'; agent_id: string; phone_linked: boolean }
  | { kind: 'deploy_error'; message: string }
  | { kind: 'link_error'; agent_id: string; message: string };

// Deterministic confetti burst — fan 14 particles outward from the centre.
// Pre-computed so React doesn't recalculate Math.random() on every render
// (which would also break SSR hydration).
const CONFETTI = Array.from({ length: 14 }, (_, i) => {
  const angleDeg = i * (360 / 14) + (i % 2 === 0 ? 0 : 11);
  const angleRad = (angleDeg * Math.PI) / 180;
  const distance = 95 + (i % 3) * 22;
  return {
    cx: Math.round(Math.cos(angleRad) * distance),
    cy: Math.round(Math.sin(angleRad) * distance),
    cr: ((i * 67) % 720) - 360,
    delay: (i * 35) % 250,
    color: ['#0071e3', '#fbbf24', '#10b981', '#ec4899'][i % 4],
  };
});

export default function Step10Page() {
  const router = useRouter();
  const { draft, status, markActivated, botId } = useWizard();
  const [state, setState] = useState<ActivateState>({ kind: 'idle' });
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [checkoutBanner, setCheckoutBanner] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'idle' && !draft) {
      router.replace('/bots/new');
    }
  }, [draft, status, router]);

  // Read the bot's current subscription status (set by checkout return + webhook).
  useEffect(() => {
    if (!botId) return;
    const supabase = createSupabaseBrowserClient();
    (async () => {
      const { data } = await supabase
        .from('bots')
        .select('client_subscription_status')
        .eq('id', botId)
        .maybeSingle();
      setSubStatus(data?.client_subscription_status ?? 'inactive');
    })();
  }, [botId]);

  // Show a one-shot banner if we just came back from Stripe Checkout.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('checkout');
    if (!code) return;
    if (code === 'success') setCheckoutBanner('Payment received. You can activate your AI receptionist now.');
    else if (code === 'cancelled') setCheckoutBanner('Checkout cancelled. You can try again.');
    else if (code === 'not_paid') setCheckoutBanner('Payment didn’t complete. Please try again.');
    else if (code === 'metadata_missing' || code === 'missing_session' || code === 'error')
      setCheckoutBanner('Something went wrong returning from checkout. Please try again.');
    // Strip the query param from the URL so it doesn't linger on refresh.
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const compiled = useMemo(() => {
    if (!draft) return null;
    try {
      return compileBot(wizardDraftToBot(draft));
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'compile failed' };
    }
  }, [draft]);

  if (!draft) {
    return <main className="mx-auto max-w-3xl px-6 py-12 text-slate-500">Loading…</main>;
  }

  async function notifyWelcome(id: string | null): Promise<void> {
    if (!id) return;
    // Fire-and-forget — failures don't block the celebration UI.
    try {
      await fetch('/api/bots/notify-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: id }),
      });
    } catch {
      /* silent */
    }
  }

  async function handleActivate() {
    if (!compiled || 'error' in compiled) return;
    // Payment gate — if no active subscription, route to Stripe Checkout
    // first. The user pays, lands back here, then clicks Activate again.
    const subActive = subStatus === 'active' || subStatus === 'trialing';
    if (!subActive) {
      if (!botId) return;
      setState({ kind: 'deploying' });
      try {
        // Forward an optional ?promo=… URL param. Server validates it's
        // scoped to this agency before applying.
        const promoCode =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('promo')?.trim() || null
            : null;
        const res = await fetch('/api/checkout/create-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bot_id: botId,
            ...(promoCode ? { promo_code: promoCode } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.url) {
          setState({
            kind: 'deploy_error',
            message: data.error || 'Couldn’t start payment. Please try again.',
          });
          return;
        }
        // Redirect to Stripe-hosted Checkout. We'll come back via
        // /api/checkout/return on success.
        window.location.href = data.url;
        return;
      } catch (e) {
        setState({
          kind: 'deploy_error',
          message: e instanceof Error ? e.message : 'Couldn’t start payment.',
        });
        return;
      }
    }

    const payload = compiled;
    setState({ kind: 'deploying' });
    try {
      // Buy the Twilio number now (post-payment) if the SMB selected one
      // during the wizard. We don't charge the agency for the number rental
      // until after the SMB has paid for their subscription. The buy route
      // is idempotent: if the number is already in this Twilio account
      // (e.g. user pasted an existing number, or a previous activation
      // already bought it), it returns success without re-purchasing.
      if (draft!.twilio_phone_e164) {
        const buyRes = await fetch('/api/twilio/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone_number: draft!.twilio_phone_e164,
            friendly_name: draft!.internal_name || draft!.business_name || undefined,
            country:
              draft!.twilio_phone_e164.startsWith('+44')
                ? 'GB'
                : draft!.twilio_phone_e164.startsWith('+1')
                  ? 'US'
                  : undefined,
          }),
        });
        const buyData = await buyRes.json();
        if (!buyRes.ok || !buyData.phone_number) {
          setState({
            kind: 'deploy_error',
            message:
              buyData.error ||
              'We couldn’t reserve your phone number. It may no longer be available — please go back to Step 6 and pick a different one.',
          });
          return;
        }
      }

      const res = await fetch('/api/retell/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      const data = await res.json();
      if (!res.ok || !data.agent_id) {
        setState({
          kind: 'deploy_error',
          message: 'We couldn’t bring your AI receptionist online. Please try again.',
        });
        return;
      }
      const agentId = data.agent_id as string;
      const llmId = (data.llm_id ?? '') as string;
      // Persist the activated state to the bot row immediately — even if the
      // phone-link step fails below, the receptionist itself is live and we
      // want the dashboard to reflect that.
      await markActivated({ agent_id: agentId, llm_id: llmId });
      // No phone number set — finish here, no linking step.
      if (!draft!.twilio_phone_e164) {
        await notifyWelcome(botId);
        setState({ kind: 'done', agent_id: agentId, phone_linked: false });
        return;
      }
      setState({ kind: 'linking', agent_id: agentId });
      const linkRes = await fetch('/api/twilio/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_e164: draft!.twilio_phone_e164,
          agent_id: agentId,
          nickname: draft!.internal_name || draft!.business_name || undefined,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok || !linkData.ok) {
        // Bot is live but phone link failed — fire welcome anyway, the email
        // template handles the "no phone" case gracefully.
        await notifyWelcome(botId);
        setState({
          kind: 'link_error',
          agent_id: agentId,
          message:
            'Your AI receptionist is ready, but we couldn’t connect your phone number. You can try again below.',
        });
        return;
      }
      await notifyWelcome(botId);
      setState({ kind: 'done', agent_id: agentId, phone_linked: true });
    } catch (e) {
      setState({
        kind: 'deploy_error',
        message: e instanceof Error ? e.message : 'Something went wrong. Please try again.',
      });
    }
  }

  async function handleLinkRetry() {
    if (state.kind !== 'link_error') return;
    const agentId = state.agent_id;
    setState({ kind: 'linking', agent_id: agentId });
    try {
      const linkRes = await fetch('/api/twilio/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_e164: draft!.twilio_phone_e164,
          agent_id: agentId,
          nickname: draft!.internal_name || draft!.business_name || undefined,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok || !linkData.ok) {
        setState({
          kind: 'link_error',
          agent_id: agentId,
          message:
            'Still couldn’t connect your phone number. Please double-check it on Step 6 and try again.',
        });
        return;
      }
      setState({ kind: 'done', agent_id: agentId, phone_linked: true });
    } catch (e) {
      setState({
        kind: 'link_error',
        agent_id: agentId,
        message: e instanceof Error ? e.message : 'Connection failed. Please try again.',
      });
    }
  }

  const compileError = compiled && 'error' in compiled ? compiled.error : null;
  const compiledOk = compiled && !('error' in compiled);
  const isWorking = state.kind === 'deploying' || state.kind === 'linking';
  const isDone = state.kind === 'done';

  return (
    <StepShell
      step={8}
      total={8}
      title={isDone ? 'You did it.' : 'Ready to go live'}
      description={
        isDone
          ? undefined
          : 'One last check, then your AI receptionist starts taking calls.'
      }
      backHref="/bots/new/9"
    >
      <div className="space-y-6">
        {!isDone && !isWorking && (
          <>
            <SummaryGrid draft={draft} />

            {checkoutBanner && (
              <div
                className={`rounded-md p-4 text-sm ${
                  checkoutBanner.startsWith('Payment received')
                    ? 'border border-green-200 bg-green-50 text-green-900'
                    : 'border border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                {checkoutBanner}
              </div>
            )}

            {compileError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-medium">Couldn&apos;t prepare your AI receptionist</p>
                <p className="mt-1 text-xs">{compileError}</p>
              </div>
            )}

            {state.kind === 'deploy_error' && (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <p className="font-medium">Activation didn&apos;t go through</p>
                <p className="mt-1 text-xs">{state.message}</p>
              </div>
            )}

            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
              <button
                type="button"
                onClick={handleActivate}
                disabled={!compiledOk}
                className="wizard-pill"
              >
                {subStatus === 'active' || subStatus === 'trialing'
                  ? 'Activate my AI receptionist'
                  : 'Subscribe & activate'}
                <span aria-hidden="true">→</span>
              </button>
              <span className="text-xs tracking-wide text-slate-400">
                {subStatus === 'active' || subStatus === 'trialing'
                  ? 'Takes a few seconds. You can change anything later.'
                  : 'You’ll be redirected to a secure payment page.'}
              </span>
            </div>
          </>
        )}

        {isWorking && (
          <ActivatingState stage={state.kind} hasPhone={!!draft.twilio_phone_e164} />
        )}

        {state.kind === 'link_error' && (
          <LinkRetryPanel
            phone={draft.twilio_phone_e164}
            message={state.message}
            onRetry={handleLinkRetry}
            onSkip={() =>
              setState({ kind: 'done', agent_id: state.agent_id, phone_linked: false })
            }
          />
        )}

        {isDone && (
          <CelebrationState
            businessName={draft.business_name}
            phone={draft.twilio_phone_e164}
            phoneLinked={state.phone_linked}
          />
        )}
      </div>
    </StepShell>
  );
}

/* ---------------------------------------------------------------------------
 * Summary grid — pre-launch review
 * ------------------------------------------------------------------------- */

function SummaryGrid({ draft }: { draft: NonNullable<ReturnType<typeof useWizard>['draft']> }) {
  const persona = draft.agent_name
    ? `${draft.agent_name} at ${draft.business_name}`
    : draft.business_name;

  const hoursLabel = Object.values(draft.working_hours ?? {}).some(Boolean)
    ? 'Set'
    : 'Always answering';

  const monthly = draft.monthly_minute_cap ?? draft.daily_minute_cap * 30;

  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl border border-slate-200 bg-white p-5">
      <SummaryItem label="Receptionist" value={persona} />
      <SummaryItem
        label="Phone number"
        value={draft.twilio_phone_e164 ?? 'Not set yet'}
        muted={!draft.twilio_phone_e164}
      />
      <SummaryItem label="Hours" value={hoursLabel} />
      <SummaryItem label="Monthly budget" value={`${monthly.toLocaleString()} minutes`} />
    </section>
  );
}

function SummaryItem({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="font-mono-tight text-[11px] tracking-[0.18em] uppercase text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1 text-base font-medium ${
          muted ? 'text-slate-400' : 'text-slate-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Activating state — single calm progress moment
 * ------------------------------------------------------------------------- */

function ActivatingState({
  stage,
  hasPhone,
}: {
  stage: 'deploying' | 'linking';
  hasPhone: boolean;
}) {
  const message =
    stage === 'deploying'
      ? 'Bringing your AI receptionist online…'
      : 'Connecting your phone number…';

  const subtext =
    stage === 'deploying'
      ? hasPhone
        ? 'After this, we’ll connect your phone number.'
        : 'Almost there.'
      : 'Routing calls to your AI receptionist.';

  return (
    <section
      className="flex flex-col items-center pt-12 text-center md:pt-16"
      aria-live="polite"
    >
      <div className="relative flex h-72 w-72 items-center justify-center">
        <div className="wizard-aurora" />
        <div className="wizard-ring" aria-hidden="true" />
        <div className="wizard-ring wizard-ring--delay-1" aria-hidden="true" />
        <div className="wizard-ring wizard-ring--delay-2" aria-hidden="true" />
        <div className="wizard-orb relative z-10" />
      </div>

      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-slate-900 md:text-3xl">
        {message}
      </h2>
      <p className="mt-2 max-w-md text-base leading-relaxed text-slate-500">{subtext}</p>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Celebration state — measured proud moment
 * ------------------------------------------------------------------------- */

function CelebrationState({
  businessName,
  phone,
  phoneLinked,
}: {
  businessName: string;
  phone: string | null;
  phoneLinked: boolean;
}) {
  return (
    <section className="flex flex-col items-center pt-8 text-center md:pt-12">
      <div className="relative flex h-72 w-72 items-center justify-center">
        <div className="wizard-aurora-warm" />

        {/* Confetti burst — one shot on mount, then gone. */}
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className="wizard-confetti"
            style={
              {
                background: c.color,
                animationDelay: `${c.delay}ms`,
                ['--cx' as string]: `${c.cx}px`,
                ['--cy' as string]: `${c.cy}px`,
                ['--cr' as string]: `${c.cr}deg`,
              } as React.CSSProperties
            }
          />
        ))}

        <svg
          className="wizard-check relative z-10 h-24 w-24 text-slate-900"
          viewBox="0 0 56 56"
          fill="none"
          stroke="currentColor"
        >
          <circle
            cx="28"
            cy="28"
            r="22"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.4"
          />
          <path
            d="M18 28.5 L25 35.5 L38 21.5"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <p
        className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400 wizard-fade-up"
        style={{ animationDelay: '700ms' }}
      >
        LIVE
      </p>
      <h2
        className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-900 md:text-4xl wizard-fade-up"
        style={{ animationDelay: '780ms' }}
      >
        Congratulations —
        <br />
        {businessName} is live.
      </h2>

      <p
        className="mt-4 max-w-md text-base leading-relaxed text-slate-500 wizard-fade-up"
        style={{ animationDelay: '860ms' }}
      >
        {phoneLinked && phone
          ? `Try calling ${phone} right now to hear your AI receptionist in action.`
          : 'Your AI receptionist is ready. Add a phone number to start taking calls.'}
      </p>

      <div
        className="mt-10 flex flex-col items-center gap-3 sm:flex-row wizard-fade-up"
        style={{ animationDelay: '940ms' }}
      >
        <Link href={'/dashboard' as never} className="wizard-pill">
          Go to dashboard
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Link retry panel — partial-success recovery
 * ------------------------------------------------------------------------- */

function LinkRetryPanel({
  phone,
  message,
  onRetry,
  onSkip,
}: {
  phone: string | null;
  message: string;
  onRetry: () => void;
  onSkip: () => void;
}) {
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5">
      <p className="text-sm font-medium text-amber-900">Phone number not connected</p>
      <p className="mt-1 text-sm text-amber-900/80">{message}</p>
      {phone && (
        <p className="mt-2 text-xs text-amber-900/70">
          Trying to connect: <span className="font-mono">{phone}</span>
        </p>
      )}
      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
        <button type="button" onClick={onRetry} className="wizard-pill">
          Try connecting again
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm font-medium text-amber-900/80 underline-offset-4 hover:text-amber-900 hover:underline"
        >
          Skip for now
        </button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Bot mapping — used by compileBot
 * ------------------------------------------------------------------------- */

function wizardDraftToBot(d: ReturnType<typeof useWizard>['draft'] & {}): Bot {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    agency_id: '00000000-0000-0000-0000-000000000000',
    client_id: '00000000-0000-0000-0000-000000000000',

    internal_name: d.internal_name,
    business_name: d.business_name,
    business_address: d.business_address,
    industry: d.industry,
    language: d.language,
    working_hours: d.working_hours,
    timezone: d.timezone,
    out_of_hours_behavior: d.out_of_hours_behavior,

    agent_name: d.agent_name,
    voice_id: d.voice_id,
    tone_chips: d.tone_chips,
    opening_line: d.opening_line,
    conversation_rules: d.conversation_rules,
    pronunciation_rules: d.pronunciation_rules,

    services: d.services,
    faqs: d.faqs,
    hard_guardrails: d.hard_guardrails,
    escalation_rules: d.escalation_rules,
    website_url: d.website_url,

    transfer_enabled: d.transfer_enabled,
    transfer_number: d.transfer_number,
    transfer_triggers: d.transfer_triggers,
    transfer_pre_line: d.transfer_pre_line,
    transfer_fallback: d.transfer_fallback,

    max_call_duration_s: d.max_call_duration_s,
    daily_minute_cap: d.daily_minute_cap,
    monthly_minute_cap: d.monthly_minute_cap,
    alert_recipients: d.alert_recipients,

    twilio_phone_e164: d.twilio_phone_e164,

    crm_status: d.crm_status,
    crm_location_id: d.crm_location_id,

    booking_enabled: d.booking_enabled,
    booking_calendar_id: d.booking_calendar_id ?? null,
    booking_services: d.booking_services,
    booking_lead_time_minutes: d.booking_lead_time_minutes,
    booking_max_future_days: d.booking_max_future_days,
    booking_confirmation_message: d.booking_confirmation_message,
    booking_hours: d.booking_hours,

    custom_tools: d.custom_tools,
    reason_branches: d.reason_branches,

    capture_fields: d.capture_fields,
    verify_capture_before_close: d.verify_capture_before_close,

    post_call_fields: d.post_call_fields,
    save_audio: d.save_audio,
    save_transcript: d.save_transcript,
    crm_workflow_id: d.crm_workflow_id ?? null,
    fallback_email_to: d.fallback_email_to ?? null,
    fallback_email_template: d.fallback_email_template ?? null,

    tier: d.tier,
    status: 'draft',
  };
}
