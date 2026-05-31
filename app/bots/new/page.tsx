'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { wizardStep } from '@/lib/wizard/steps.ts';
import type { PrefilledBot } from '@/src/prefill/types.ts';

type IndustryGroup = { category: string; items: string[] };

const INDUSTRY_GROUPS: IndustryGroup[] = [
  {
    category: 'Healthcare',
    items: [
      'Dental practice',
      'GP surgery',
      'Veterinary clinic',
      'Physiotherapy',
      'Chiropractor',
      'Optician',
      'Counselling / Therapy',
      'Aesthetics clinic',
      'Care home',
      'Pharmacy',
    ],
  },
  {
    category: 'Property & Real Estate',
    items: [
      'Estate agent',
      'Letting agent',
      'Property manager',
      'Mortgage broker',
      'Surveyor',
      'Conveyancer',
    ],
  },
  {
    category: 'Trades & Home Services',
    items: [
      'Plumbing',
      'Electrician',
      'Heating / Gas engineer',
      'Roofing',
      'Locksmith',
      'Cleaning service',
      'Pest control',
      'Landscaping / Gardening',
      'Painter & decorator',
      'Removals',
    ],
  },
  {
    category: 'Construction',
    items: ['Builder', 'General contractor', 'Architect', 'Civil engineering'],
  },
  {
    category: 'Professional Services',
    items: [
      'Accountant',
      'Bookkeeper',
      'Solicitor / Law firm',
      'Financial adviser',
      'Insurance broker',
      'Marketing agency',
      'Recruitment agency',
      'IT support',
      'Consultancy',
    ],
  },
  {
    category: 'Hospitality',
    items: ['Restaurant', 'Café / Coffee shop', 'Pub / Bar', 'Hotel', 'B&B', 'Catering'],
  },
  {
    category: 'Beauty & Personal Care',
    items: [
      'Hair salon',
      'Barber',
      'Beauty salon / Spa',
      'Nail salon',
      'Massage therapy',
      'Tattoo studio',
    ],
  },
  {
    category: 'Fitness & Wellness',
    items: ['Gym / Fitness studio', 'Yoga / Pilates studio', 'Personal trainer', 'Sports coach'],
  },
  {
    category: 'Automotive',
    items: ['Auto repair / Garage', 'MOT centre', 'Car dealership', 'Valeting / Detailing'],
  },
  {
    category: 'Education',
    items: ['Tutoring service', 'Driving school', 'Music school', 'Childcare / Nursery'],
  },
  {
    category: 'Retail',
    items: ['Retail shop', 'E-commerce store', 'Florist', 'Jewellery', 'Bridal'],
  },
  {
    category: 'Events',
    items: ['Event venue', 'Photographer / Videographer', 'Wedding planner', 'DJ / Entertainment'],
  },
  {
    category: 'Logistics',
    items: ['Courier / Delivery', 'Storage / Self-storage', 'Taxi / Private hire'],
  },
];

const ALL_INDUSTRIES: { label: string; category: string }[] = INDUSTRY_GROUPS.flatMap((g) =>
  g.items.map((label) => ({ label, category: g.category })),
);

const SAMPLE_PLACEHOLDER = `I run a dental practice in Manchester. The receptionist is called Sarah. She books cleanings on our calendar (Mon-Fri 9-5), answers FAQs about price, parking, and opening hours, and takes a detailed message for anything she can't handle.

Always capture name, phone, and email before booking. Never give medical advice.`;

type PrefillResponse = {
  bot: PrefilledBot;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

type View =
  | { kind: 'idle' }
  | { kind: 'building'; stage: number }
  | { kind: 'ready'; result: PrefillResponse }
  | { kind: 'error'; message: string };

const { step: STEP_NUMBER, total: STEP_TOTAL } = wizardStep('intro');

export default function NewBotPage() {
  const router = useRouter();
  const { setDraft, draft, botId, status } = useWizard();

  const [description, setDescription] = useState('');
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [elapsedMs, setElapsedMs] = useState(0);
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      stageTimers.current.forEach(clearTimeout);
      if (tickTimer.current) clearInterval(tickTimer.current);
    };
  }, []);

  // If the wizard loaded an existing bot (via ?bot=… URL param from the
  // dashboard's Edit link), skip the description form and jump straight to
  // step 2 with their data populated.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (status !== 'idle') return;
    if (!draft || !botId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('bot')) {
      router.replace('/bots/new/1' as never);
    }
  }, [status, draft, botId, router]);

  function startElapsed() {
    setElapsedMs(0);
    const startedAt = Date.now();
    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
  }

  function stopElapsed() {
    if (tickTimer.current) {
      clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
  }

  function clearStageTimers() {
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
  }

  function scheduleStages() {
    clearStageTimers();
    // Each stage holds for ~2.5s; the 4 stages fill ~10s of OpenAI's typical
    // 5-15s window. If the API resolves earlier we skip ahead to 'ready'.
    [2500, 5000, 7500].forEach((delay, i) => {
      const t = setTimeout(() => {
        setView((curr) => (curr.kind === 'building' ? { kind: 'building', stage: i + 1 } : curr));
      }, delay);
      stageTimers.current.push(t);
    });
  }

  const stages = buildStages(Boolean(website.trim()));

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setView({ kind: 'building', stage: 0 });
    scheduleStages();
    startElapsed();
    try {
      const res = await fetch('/api/prefill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          industry: industry || undefined,
          website_url: website || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const payload = data as PrefillResponse;
      setDraft(payload.bot);
      clearStageTimers();
      // Hold for a beat so the final stage message has time to register
      // before the orb resolves into the checkmark.
      setTimeout(() => {
        stopElapsed();
        setView({ kind: 'ready', result: payload });
      }, 350);
    } catch (e) {
      clearStageTimers();
      stopElapsed();
      setView({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  const isBuilding = view.kind === 'building';
  const isReady = view.kind === 'ready';
  const railProgress = STEP_NUMBER / STEP_TOTAL;

  return (
    <main className="relative min-h-screen">
      <ProgressRail step={STEP_NUMBER} total={STEP_TOTAL} progress={railProgress} />

      <div className="mx-auto max-w-3xl px-6 pt-24 pb-32 md:pt-32">
        <nav className="mb-10 text-sm">
          <Link
            href="/"
            className="text-slate-400 transition-colors hover:text-slate-900"
          >
            ← Home
          </Link>
        </nav>

        {!isBuilding && !isReady && (
          <>
            <Hero />
            <form
              onSubmit={handleGenerate}
              className="mt-12 space-y-8 wizard-fade-up"
              style={{ animationDelay: '120ms' }}
            >
              <FormField
                label="Industry"
                htmlFor="industry"
                hint="Type to search, or pick from the list. Don't see yours? Just type it in."
              >
                <IndustryCombobox value={industry} onChange={setIndustry} />
              </FormField>

              <FormField
                label="Describe your business and what the AI receptionist should do"
                htmlFor="description"
              >
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={SAMPLE_PLACEHOLDER}
                  required
                  rows={9}
                  className="wizard-focus block w-full rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-base leading-relaxed text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-500"
                />
              </FormField>

              <FormField
                label="Website"
                htmlFor="website"
                hint="Optional — we'll read it for services, hours, and tone."
              >
                <input
                  id="website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://"
                  className="wizard-focus block w-full rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-500"
                />
              </FormField>

              <div className="flex flex-col items-start gap-3 pt-2 sm:flex-row sm:items-center sm:gap-4">
                <button
                  type="submit"
                  disabled={!description.trim()}
                  className="wizard-pill"
                >
                  Build my receptionist
                  <span aria-hidden="true">→</span>
                </button>
                <span className="text-xs tracking-wide text-slate-400">
                  It can take up to 60 seconds.
                </span>
              </div>
            </form>

            {view.kind === 'error' && (
              <div
                className="mt-8 rounded-lg border border-red-100 bg-red-50/50 p-5 wizard-fade-in"
                role="alert"
              >
                <p className="text-sm font-medium text-red-900">
                  We couldn&apos;t build the knowledge.
                </p>
                <p className="mt-1 text-sm text-red-800/80">{view.message}</p>
              </div>
            )}
          </>
        )}

        {isBuilding && (
          <BuildingState stage={view.stage} stages={stages} elapsedMs={elapsedMs} />
        )}

        {isReady && (
          <ReadyState onContinue={() => router.push('/bots/new/1' as never)} />
        )}
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------------------
 * Components
 * ------------------------------------------------------------------------- */

function ProgressRail({
  step,
  total,
  progress,
}: {
  step: number;
  total: number;
  progress: number;
}) {
  return (
    <div className="fixed inset-x-0 top-0 z-10 bg-[color:var(--wizard-canvas)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <span className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
          VOICE BUILDER
        </span>
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono-tight text-[11px] tracking-[0.2em] uppercase text-slate-400">
            Step
          </span>
          <span className="font-mono-tight text-[16px] font-semibold tracking-tight tabular-nums text-slate-900">
            {String(step).padStart(2, '0')}
          </span>
          <span className="font-mono-tight text-[13px] tracking-[0.18em] uppercase text-slate-400">
            of
          </span>
          <span className="font-mono-tight text-[16px] font-semibold tracking-tight tabular-nums text-slate-900">
            {String(total).padStart(2, '0')}
          </span>
        </div>
      </div>
      <div className="relative h-[3px] bg-slate-200/70">
        <div
          className="wizard-rail-bar absolute inset-y-0 left-0 right-0 origin-left rounded-r-full bg-slate-900"
          style={{ ['--rail-progress' as string]: progress }}
        />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <header>
      <p
        className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400 wizard-fade-up"
        style={{ animationDelay: '0ms' }}
      >
        BEGIN
      </p>
      <h1
        className="mt-3 text-4xl font-semibold tracking-[-0.035em] text-slate-900 md:text-6xl wizard-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        Tell us about
        <br />
        your business.
      </h1>
      <p
        className="mt-5 max-w-xl text-lg leading-relaxed text-slate-500 wizard-fade-up"
        style={{ animationDelay: '120ms' }}
      >
        We&apos;ll read your description and study your website, then build a complete
        receptionist you can shape across the next seven steps.
      </p>
    </header>
  );
}

function IndustryCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const query = value.trim().toLowerCase();
  const filtered = query
    ? ALL_INDUSTRIES.filter(
        (i) =>
          i.label.toLowerCase().includes(query) ||
          i.category.toLowerCase().includes(query),
      )
    : ALL_INDUSTRIES;

  // Reset active row whenever the visible list changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Keep the highlighted row scrolled into view during keyboard nav.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function pick(label: string) {
    onChange(label);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIndex]) {
        e.preventDefault();
        pick(filtered[activeIndex].label);
      } else if (open && filtered.length === 0 && value.trim()) {
        // No match — confirm the custom value the user typed and close.
        e.preventDefault();
        pick(value.trim());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // When showing the full (unfiltered) list, group rows by category with
  // headers. When filtering, render a flat list of matches.
  const showGrouped = !query;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id="industry"
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Start typing or pick from the list"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="industry-listbox"
        className="wizard-focus block w-full rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-500"
      />
      {open && (
        <div
          id="industry-listbox"
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <button
              type="button"
              role="option"
              aria-selected
              onClick={() => pick(value.trim())}
              className="flex w-full items-center justify-between gap-3 bg-slate-100 px-4 py-2 text-left text-sm text-slate-900"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden className="text-slate-400">+</span>
                <span>
                  Use &ldquo;<span className="font-medium">{value.trim()}</span>&rdquo;
                </span>
              </span>
              <span className="text-[11px] text-slate-400">Custom</span>
            </button>
          ) : showGrouped ? (
            (() => {
              let lastCategory = '';
              return filtered.map((item, idx) => {
                const showHeader = item.category !== lastCategory;
                lastCategory = item.category;
                return (
                  <div key={`${item.category}-${item.label}`}>
                    {showHeader && (
                      <div className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                        {item.category}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      data-idx={idx}
                      aria-selected={idx === activeIndex}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => pick(item.label)}
                      className={`block w-full px-4 py-2 text-left text-sm transition-colors ${
                        idx === activeIndex
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  </div>
                );
              });
            })()
          ) : (
            filtered.map((item, idx) => (
              <button
                key={`${item.category}-${item.label}`}
                type="button"
                role="option"
                data-idx={idx}
                aria-selected={idx === activeIndex}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => pick(item.label)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ${
                  idx === activeIndex
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-700'
                }`}
              >
                <span>{item.label}</span>
                <span className="text-[11px] text-slate-400">{item.category}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-[13px] font-medium tracking-tight text-slate-700"
      >
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-2 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function BuildingState({
  stage,
  stages,
  elapsedMs,
}: {
  stage: number;
  stages: string[];
  elapsedMs: number;
}) {
  const clampedStage = Math.min(stage, stages.length - 1);
  return (
    <section
      className="flex flex-col items-center pt-12 text-center md:pt-20"
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
        Building knowledge.
      </h2>
      <p className="mt-3 max-w-md text-base leading-relaxed text-slate-500">
        We&apos;re analysing what you shared to build the knowledge your AI
        receptionist needs to handle every call.
      </p>

      <div className="mt-10 h-7 overflow-hidden">
        <p
          key={clampedStage}
          className="wizard-stage font-mono-tight text-[12px] tracking-[0.12em] uppercase text-slate-500"
        >
          {stages[clampedStage]}
        </p>
      </div>

      <div className="mt-6 flex gap-1.5">
        {stages.map((_, i) => (
          <span
            key={i}
            className={`h-1 w-6 rounded-full transition-colors duration-500 ${
              i <= clampedStage ? 'bg-slate-900' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <p
        className="mt-8 font-mono-tight text-[28px] tracking-[-0.02em] text-slate-900 tabular-nums"
        aria-label="Elapsed time"
      >
        {formatElapsed(elapsedMs)}
      </p>
      <p className="mt-1 font-mono-tight text-[11px] tracking-[0.18em] uppercase text-slate-400">
        Elapsed
      </p>
    </section>
  );
}

function ReadyState({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="flex flex-col items-center pt-12 text-center md:pt-20">
      <div className="relative flex h-72 w-72 items-center justify-center">
        <div
          className="wizard-aurora"
          style={{ animation: 'aurora-breathe 6s ease-in-out infinite', opacity: 0.7 }}
        />
        <svg
          className="wizard-check relative z-10 h-20 w-20 text-slate-900"
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
        READY
      </p>
      <h2
        className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-900 md:text-4xl wizard-fade-up"
        style={{ animationDelay: '780ms' }}
      >
        Your receptionist&apos;s
        <br />
        knowledge is ready.
      </h2>
      <p
        className="mt-4 max-w-md text-base leading-relaxed text-slate-500 wizard-fade-up"
        style={{ animationDelay: '860ms' }}
      >
        We&apos;ve drafted a complete AI receptionist from what you shared. You can
        shape every detail in the next seven steps.
      </p>

      <button
        type="button"
        onClick={onContinue}
        className="wizard-pill mt-10 wizard-fade-up"
        style={{ animationDelay: '940ms' }}
      >
        Continue to Step 2
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

function buildStages(hasWebsite: boolean): string[] {
  return [
    'Reading your description',
    hasWebsite ? 'Studying your website' : 'Gathering industry context',
    'Building receptionist personality',
    'Setting up booking rules and FAQs',
  ];
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
