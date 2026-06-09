'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { compileBot } from '@/src/compile/compileBot.ts';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { wizardStep } from '@/lib/wizard/steps.ts';
import { Field, inputClass } from '@/components/wizard/Field.tsx';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { Bot } from '@/src/compile/types.ts';

const E164_RE = /^\+\d{8,15}$/;

const COUNTRIES: Array<{ value: string; label: string }> = [
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
];

type NumberType = 'local' | 'tollfree' | 'mobile';

interface AvailableNumber {
  phone_number: string;
  friendly_name: string;
  locality: string | null;
  region: string | null;
  iso_country: string;
  capabilities: { voice: boolean; SMS: boolean; MMS: boolean; fax: boolean };
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; numbers: AvailableNumber[] }
  | { kind: 'error'; message: string };

type ActivateState =
  | { kind: 'idle' }
  | { kind: 'deploying' }
  | { kind: 'linking'; agent_id: string }
  | { kind: 'done'; agent_id: string; phone_linked: boolean }
  | { kind: 'deploy_error'; message: string }
  | { kind: 'link_error'; agent_id: string; message: string };

// Deterministic confetti burst — fan 14 particles outward from the centre.
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

export default function Step6Page() {
  const router = useRouter();
  const { draft, patch, status, agencyId, botStatus, markActivated, botId } = useWizard();

  // Phone number picker
  const [country, setCountry] = useState('GB');
  const [type, setType] = useState<NumberType>('local');
  const [contains, setContains] = useState('');
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });

  // Activation
  const [activate, setActivate] = useState<ActivateState>({ kind: 'idle' });
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [checkoutBanner, setCheckoutBanner] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [showPromoField, setShowPromoField] = useState(false);

  useEffect(() => {
    if (status === 'idle' && !draft) router.replace('/bots/new');
    if (status === 'idle' && botStatus === 'live' && activate.kind === 'idle') router.replace('/dashboard');
  }, [draft, status, botStatus, activate.kind, router]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('checkout');
    if (!code) return;
    if (code === 'success') setCheckoutBanner('Payment received. You can activate your AI receptionist now.');
    else if (code === 'cancelled') setCheckoutBanner('Checkout cancelled. You can try again.');
    else if (code === 'not_paid') setCheckoutBanner("Payment didn't complete. Please try again.");
    else setCheckoutBanner('Something went wrong returning from checkout. Please try again.');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromUrl = new URLSearchParams(window.location.search).get('promo')?.trim();
    if (fromUrl) {
      setPromoCode(fromUrl.toUpperCase());
      setShowPromoField(true);
    }
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

  const isLive = botStatus === 'live';
  const phoneValue = draft.twilio_phone_e164 ?? '';
  const looksValid = phoneValue === '' || E164_RE.test(phoneValue);
  const isDone = activate.kind === 'done';
  const isWorking = activate.kind === 'deploying' || activate.kind === 'linking';
  const compiledOk = compiled && !('error' in compiled);
  const compileError = compiled && 'error' in compiled ? compiled.error : null;
  const subActive = subStatus === 'active' || subStatus === 'trialing';

  async function handleSearch() {
    setSearch({ kind: 'loading' });
    try {
      const params = new URLSearchParams();
      params.set('country', country);
      params.set('type', type);
      if (contains.trim()) params.set('contains', contains.trim());
      if (agencyId) params.set('agency_id', agencyId);
      const res = await fetch(`/api/twilio/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setSearch({ kind: 'error', message: scrubProvider(data.error) || 'Search failed' });
        return;
      }
      setSearch({ kind: 'results', numbers: data.numbers ?? [] });
    } catch (e) {
      setSearch({ kind: 'error', message: e instanceof Error ? scrubProvider(e.message) : 'Search failed' });
    }
  }

  function handleSelect(phone_number: string) {
    patch({ twilio_phone_e164: phone_number });
    setSearch({ kind: 'idle' });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function notifyWelcome(id: string | null): Promise<void> {
    if (!id) return;
    try {
      await fetch('/api/bots/notify-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: id }),
      });
    } catch { /* silent */ }
  }

  async function handleActivate() {
    if (!compiledOk) return;
    if (!subActive) {
      if (!botId) return;
      setActivate({ kind: 'deploying' });
      try {
        const trimmedPromo = promoCode.trim();
        const res = await fetch('/api/checkout/create-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bot_id: botId,
            ...(trimmedPromo ? { promo_code: trimmedPromo } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.url) {
          setActivate({ kind: 'deploy_error', message: data.error || "Couldn't start payment. Please try again." });
          return;
        }
        window.location.href = data.url;
        return;
      } catch (e) {
        setActivate({ kind: 'deploy_error', message: e instanceof Error ? e.message : "Couldn't start payment." });
        return;
      }
    }

    const payload = compiled;
    setActivate({ kind: 'deploying' });
    try {
      if (draft.twilio_phone_e164) {
        const buyRes = await fetch('/api/twilio/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone_number: draft.twilio_phone_e164,
            friendly_name: draft.internal_name || draft.business_name || undefined,
            country: draft.twilio_phone_e164.startsWith('+44')
              ? 'GB'
              : draft.twilio_phone_e164.startsWith('+1')
                ? 'US'
                : undefined,
            agency_id: agencyId ?? undefined,
          }),
        });
        const buyData = await buyRes.json();
        if (!buyRes.ok || !buyData.phone_number) {
          setActivate({
            kind: 'deploy_error',
            message: buyData.error || "We couldn't reserve your phone number. It may no longer be available — please pick a different one.",
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
        setActivate({ kind: 'deploy_error', message: "We couldn't bring your AI receptionist online. Please try again." });
        return;
      }
      const agentId = data.agent_id as string;
      const llmId = (data.llm_id ?? '') as string;
      await markActivated({ agent_id: agentId, llm_id: llmId });
      if (!draft.twilio_phone_e164) {
        await notifyWelcome(botId);
        setActivate({ kind: 'done', agent_id: agentId, phone_linked: false });
        return;
      }
      setActivate({ kind: 'linking', agent_id: agentId });
      const linkRes = await fetch('/api/twilio/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_e164: draft.twilio_phone_e164,
          agent_id: agentId,
          nickname: draft.internal_name || draft.business_name || undefined,
          agency_id: agencyId ?? undefined,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok || !linkData.ok) {
        await notifyWelcome(botId);
        setActivate({
          kind: 'link_error',
          agent_id: agentId,
          message: "Your AI receptionist is ready, but we couldn't connect your phone number. You can try again below.",
        });
        return;
      }
      await notifyWelcome(botId);
      setActivate({ kind: 'done', agent_id: agentId, phone_linked: true });
    } catch (e) {
      setActivate({ kind: 'deploy_error', message: e instanceof Error ? e.message : 'Something went wrong. Please try again.' });
    }
  }

  async function handleLinkRetry() {
    if (activate.kind !== 'link_error') return;
    const agentId = activate.agent_id;
    setActivate({ kind: 'linking', agent_id: agentId });
    try {
      const linkRes = await fetch('/api/twilio/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_e164: draft.twilio_phone_e164,
          agent_id: agentId,
          nickname: draft.internal_name || draft.business_name || undefined,
          agency_id: agencyId ?? undefined,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok || !linkData.ok) {
        setActivate({
          kind: 'link_error',
          agent_id: agentId,
          message: "Still couldn't connect your phone number. Please pick a different one and try again.",
        });
        return;
      }
      setActivate({ kind: 'done', agent_id: agentId, phone_linked: true });
    } catch (e) {
      setActivate({ kind: 'link_error', agent_id: agentId, message: e instanceof Error ? e.message : 'Connection failed. Please try again.' });
    }
  }

  return (
    <StepShell
      {...wizardStep('phone')}
      title={isDone ? 'You did it.' : 'Phone & activation'}
      description={isDone ? undefined : 'Choose a number for callers to reach your AI receptionist, then go live.'}
      backHref={isDone ? undefined : '/bots/new/2'}
    >
      {isDone ? (
        <CelebrationState
          businessName={draft.business_name}
          phone={draft.twilio_phone_e164}
          phoneLinked={(activate as { phone_linked: boolean }).phone_linked}
        />
      ) : isWorking ? (
        <ActivatingState
          stage={activate.kind as 'deploying' | 'linking'}
          hasPhone={!!draft.twilio_phone_e164}
        />
      ) : activate.kind === 'link_error' ? (
        <LinkRetryPanel
          phone={draft.twilio_phone_e164}
          message={activate.message}
          onRetry={handleLinkRetry}
          onSkip={() => setActivate({ kind: 'done', agent_id: activate.agent_id, phone_linked: false })}
        />
      ) : (
        <div className="space-y-8">
          {/* ── Phone number picker ── */}
          <div className="space-y-5">
            {phoneValue ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-5">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600 text-white"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path
                        fillRule="evenodd"
                        d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.414 0l-3.5-3.5a1 1 0 011.414-1.42L8.5 12.086l6.79-6.795a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-green-900">Number selected</p>
                    <p className="mt-1 font-mono text-base text-green-900">{phoneValue}</p>
                    <p className="mt-2 text-xs text-green-800">
                      {isLive
                        ? 'This number is live and cannot be changed.'
                        : <>Your number is ready. Pick a different one below if needed.</>}
                    </p>
                    {!isLive && (
                      <button
                        type="button"
                        onClick={() => patch({ twilio_phone_e164: null })}
                        className="mt-2 text-xs font-medium text-green-700 underline hover:text-green-900"
                      >
                        Clear and pick a different number
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : isLive ? null : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Country" htmlFor="t_country">
                    <select
                      id="t_country"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className={inputClass}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Type" htmlFor="t_type">
                    <select
                      id="t_type"
                      value={type}
                      onChange={(e) => setType(e.target.value as NumberType)}
                      className={inputClass}
                    >
                      <option value="local">Local</option>
                      <option value="tollfree">Toll-free</option>
                      <option value="mobile">Mobile</option>
                    </select>
                  </Field>
                  <Field
                    label="Contains"
                    optional
                    htmlFor="t_contains"
                    hint="Digits the number must include — e.g. 999."
                  >
                    <input
                      id="t_contains"
                      type="text"
                      placeholder="999"
                      value={contains}
                      onChange={(e) => setContains(e.target.value)}
                      className={inputClass}
                      inputMode="numeric"
                    />
                  </Field>
                </div>

                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={search.kind === 'loading'}
                  className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {search.kind === 'loading' ? 'Searching…' : 'Search number'}
                </button>

                {search.kind === 'error' && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <p className="font-medium">Search failed</p>
                    <p className="mt-1 text-xs">{search.message}</p>
                  </div>
                )}

                {search.kind === 'results' && search.numbers.length > 0 && (
                  <p className="text-xs text-slate-500">
                    Choose the number your customers will call to reach your AI receptionist.
                  </p>
                )}

                {search.kind === 'results' && (
                  <div className="rounded-md border border-slate-200">
                    {search.numbers.length === 0 ? (
                      <div className="p-4 text-sm text-slate-500">
                        <p>No numbers matched.</p>
                        <p className="mt-1 text-xs">
                          Try a different country, change the number type, or clear the &quot;Contains&quot; pattern.
                        </p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {search.numbers.map((n) => {
                          const subParts = [n.locality, n.region, n.iso_country].filter(Boolean);
                          return (
                            <li key={n.phone_number} className="flex items-center justify-between gap-3 px-3 py-2">
                              <div className="min-w-0">
                                <p className="font-mono text-sm">{n.phone_number}</p>
                                <p className="truncate text-xs text-slate-500">
                                  {subParts.join(' · ') || n.friendly_name}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSelect(n.phone_number)}
                                className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                              >
                                Select
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Activation section ── */}
          {!isLive && (
            <>
              <div className="border-t border-slate-200" />

              <div className="space-y-4">
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

                {activate.kind === 'deploy_error' && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    <p className="font-medium">Activation didn&apos;t go through</p>
                    <p className="mt-1 text-xs">{activate.message}</p>
                  </div>
                )}

                {!subActive && (
                  <div>
                    {showPromoField ? (
                      <div className="rounded-md border border-slate-200 bg-white p-4">
                        <label className="font-mono-tight text-[11px] tracking-[0.18em] uppercase text-slate-400">
                          Promo code
                        </label>
                        <input
                          type="text"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                          placeholder="EARLY20"
                          className="mt-2 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm uppercase tracking-wide text-slate-900 focus:border-slate-500 focus:outline-none"
                        />
                        <p className="mt-1.5 text-xs text-slate-400">
                          Applied at checkout. Leave blank if you don&apos;t have one.
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowPromoField(true)}
                        className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline"
                      >
                        Have a promo code?
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <button
                    type="button"
                    onClick={handleActivate}
                    disabled={!compiledOk}
                    className="wizard-pill"
                  >
                    {subActive ? 'Activate my AI receptionist' : 'Subscribe & activate'}
                    <span aria-hidden="true">→</span>
                  </button>
                  <span className="text-xs tracking-wide text-slate-400">
                    {subActive
                      ? 'Takes a few seconds. You can change anything later.'
                      : "You'll be redirected to a secure payment page."}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </StepShell>
  );
}

/* ---------------------------------------------------------------------------
 * Activating state
 * ------------------------------------------------------------------------- */

function ActivatingState({ stage, hasPhone }: { stage: 'deploying' | 'linking'; hasPhone: boolean }) {
  const message = stage === 'deploying' ? 'Bringing your AI receptionist online…' : 'Connecting your phone number…';
  const subtext =
    stage === 'deploying'
      ? hasPhone ? "After this, we'll connect your phone number." : 'Almost there.'
      : 'Routing calls to your AI receptionist.';

  return (
    <section className="flex flex-col items-center pt-12 text-center md:pt-16" aria-live="polite">
      <div className="relative flex h-72 w-72 items-center justify-center">
        <div className="wizard-aurora" />
        <div className="wizard-ring" aria-hidden="true" />
        <div className="wizard-ring wizard-ring--delay-1" aria-hidden="true" />
        <div className="wizard-ring wizard-ring--delay-2" aria-hidden="true" />
        <div className="wizard-orb relative z-10" />
      </div>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-slate-900 md:text-3xl">{message}</h2>
      <p className="mt-2 max-w-md text-base leading-relaxed text-slate-500">{subtext}</p>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Celebration state
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
          <circle cx="28" cy="28" r="22" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <path d="M18 28.5 L25 35.5 L38 21.5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
 * Link retry panel
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

function scrubProvider(message: string | undefined | null): string {
  if (!message) return '';
  return message
    .replace(/\bTwilio\b/gi, 'number search')
    .replace(/\bRetell\s*AI\b/gi, 'voice service')
    .replace(/\bRetell\b/gi, 'voice service');
}
