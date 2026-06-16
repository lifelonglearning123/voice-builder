import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMarketingAgency } from '@/lib/agency/marketing';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { Reveal, RevealGroup } from '@/components/marketing/Reveal';
import type { RegionalCopy } from '@/lib/marketing/regional';

interface Step {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  mockup: 'describe' | 'voice' | 'number' | 'live';
}

type MockupCopy = RegionalCopy['mockup'];

export const runtime = 'nodejs';

export default async function HowItWorksPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, agency] = await Promise.all([
    supabase.auth.getUser(),
    getMarketingAgency(),
  ]);

  const copy = agency.marketingCopy;
  const steps = buildSteps(copy);

  return (
    <MarketingShell agency={agency} signedIn={!!user} activeRoute="how">
      <section className="relative overflow-hidden">
        <div className="hero-glow" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 pb-16 pt-24 text-center md:pt-32">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              How it works
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h1 className="display-headline mt-5 text-[clamp(2.75rem,6.5vw,5rem)] text-slate-900">
              Set up in twelve minutes.<br />
              <span className="text-slate-400">Answering calls in twelve more.</span>
            </h1>
          </Reveal>
          <Reveal delayMs={160}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-snug tracking-tight text-slate-600">
              No phone system to learn. No script to write. No developer to hire.
              The wizard walks you through it... the AI handles everything else.
              By the time your coffee&apos;s cold, your phone is ringing.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-7xl px-6 py-16">
          {steps.map((step, i) => (
            <StepBlock
              key={step.title}
              index={i + 1}
              step={step}
              flip={i % 2 === 1}
              mockup={copy.mockup}
            />
          ))}
        </div>
      </section>

      {/* Recap strip */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              What happens after a call
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h2 className="display-headline-sm mt-4 max-w-2xl text-4xl text-slate-900 md:text-6xl">
              The work happens<br />during the call, not after.
            </h2>
          </Reveal>

          <RevealGroup className="mt-14 grid gap-5 md:grid-cols-3">
            {AFTER_CALL.map((item) => (
              <Reveal key={item.title}>
                <div className="marketing-card h-full p-7">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg"
                    style={{
                      background: 'rgba(var(--agency-accent-rgb), 0.08)',
                      color: 'var(--agency-accent)',
                    }}
                  >
                    {item.icon}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed tracking-tight text-slate-600">
                    {item.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-slate-900/[0.06]">
        <div className="mx-auto max-w-4xl px-6 py-32 text-center">
          <Reveal>
            <h2 className="display-headline text-[clamp(2.5rem,6vw,5rem)] text-slate-900">
              Sign up. Describe your business.<br />
              <span style={{ color: 'var(--agency-accent)' }}>Then make a coffee.</span>
            </h2>
          </Reveal>
          <Reveal delayMs={120}>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link
                href={user ? '/dashboard' as never : '/signup' as never}
                className="marketing-pill"
              >
                {user ? 'Go to dashboard' : 'Start free'}
                <ArrowIcon />
              </Link>
              <Link href={'/pricing' as never} className="marketing-pill marketing-pill--ghost">
                See pricing
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}

function StepBlock({
  index,
  step,
  flip,
  mockup,
}: {
  index: number;
  step: Step;
  flip: boolean;
  mockup: MockupCopy;
}) {
  return (
    <Reveal>
      <div className={'grid items-center gap-12 py-16 lg:grid-cols-2 lg:gap-20 ' + (flip ? 'lg:[&>*:first-child]:order-2' : '')}>
        <div>
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium"
              style={{
                background: 'rgba(var(--agency-accent-rgb), 0.08)',
                color: 'var(--agency-accent)',
              }}
            >
              {index}
            </span>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              {step.eyebrow}
            </p>
          </div>
          <h2 className="display-headline-sm mt-5 text-3xl text-slate-900 md:text-5xl">
            {step.title}
          </h2>
          <p className="mt-5 max-w-lg text-base leading-snug tracking-tight text-slate-600 md:text-lg">
            {step.body}
          </p>
          {step.bullets && (
            <ul className="mt-6 space-y-2.5">
              {step.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-sm tracking-tight text-slate-700">
                  <CheckIcon />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="relative">
          <div className="hero-glow" aria-hidden />
          <WizardMockup variant={step.mockup} mockup={mockup} />
        </div>
      </div>
    </Reveal>
  );
}

function WizardMockup({
  variant,
  mockup,
}: {
  variant: 'describe' | 'voice' | 'number' | 'live';
  mockup: MockupCopy;
}) {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-slate-900/8 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_60px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="ml-3 font-mono-tight text-[10px] text-slate-400">
          wizard · {variant === 'describe' ? 'step 1' : variant === 'voice' ? 'step 4' : variant === 'number' ? 'step 6' : 'live'}
        </span>
      </div>
      <div className="p-6">
        {variant === 'describe' && <DescribeMock mockup={mockup} />}
        {variant === 'voice' && <VoiceMock />}
        {variant === 'number' && <NumberMock mockup={mockup} />}
        {variant === 'live' && <LiveMock />}
      </div>
    </div>
  );
}

function DescribeMock({ mockup }: { mockup: MockupCopy }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-tight text-slate-500">Tell us about your business</p>
      <div className="mt-3 rounded-xl border border-slate-200 p-3 text-sm tracking-tight text-slate-700">
        {mockup.describeBody}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="font-mono-tight uppercase tracking-[0.18em] text-slate-400">Website</span>
        <span className="font-mono-tight tracking-tight text-slate-600">{mockup.websiteDomain}</span>
      </div>
    </div>
  );
}

function VoiceMock() {
  const voices = ['Sarah · Friendly', 'Mark · Professional', 'Emma · Calm', 'James · Confident'];
  return (
    <div>
      <p className="text-xs font-medium tracking-tight text-slate-500">Pick a voice</p>
      <div className="mt-3 space-y-2">
        {voices.map((v, i) => (
          <div
            key={v}
            className={
              'flex items-center justify-between rounded-lg border p-2.5 ' +
              (i === 0 ? 'border-[var(--agency-accent)] bg-[rgba(var(--agency-accent-rgb),0.04)]' : 'border-slate-200')
            }
          >
            <span className="text-sm tracking-tight text-slate-900">{v}</span>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white"
              aria-label="Preview"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NumberMock({ mockup }: { mockup: MockupCopy }) {
  return (
    <div>
      <div className="rounded-lg border border-green-200 bg-green-50 p-3">
        <p className="text-xs font-medium text-green-900">Number selected</p>
        <p className="mt-1 font-mono-tight text-base text-green-900">{mockup.phoneNumber}</p>
        <p className="mt-2 text-[11px] text-green-800">{mockup.phoneCityLabel} · forwards from your existing line</p>
      </div>
      <p className="mt-4 text-[11px] tracking-tight text-slate-500">
        Activates the moment your subscription starts. No carrier paperwork.
      </p>
    </div>
  );
}

function LiveMock() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono-tight text-[10px] uppercase tracking-[0.18em] text-slate-400">Live</p>
          <p className="mt-1 font-semibold tracking-tight text-slate-900">
            Acme Plumbing AI · answering now
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          Healthy
        </span>
      </div>
      <div className="mt-5 space-y-2">
        {[
          ['Today', '11 calls'],
          ['Captured', '9 leads'],
          ['Booked', '4 jobs'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
            <span className="text-slate-500">{k}</span>
            <span className="font-medium tracking-tight text-slate-900">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildSteps(copy: RegionalCopy): Step[] {
  return [
    {
      eyebrow: 'Step 1',
      title: 'Describe your business.',
      body: "Two sentences. A website URL. That's it. The AI reads every page you've published — services, hours, prices, the awkward FAQs — and drafts a receptionist that already sounds like you. No forms. No long questionnaire. No tedious admin you'll abandon halfway.",
      bullets: [
        'Plain English — no fields to fill in',
        'Reads your website, FAQs and existing pages',
        'Edit anything the AI gets wrong before going live',
      ],
      mockup: 'describe',
    },
    {
      eyebrow: 'Step 2',
      title: 'Pick a voice.',
      body: `Four production voices. Each one preview-able in a single tap. Pick the one your customers will be most comfortable hearing... and switch later if a different one tests better. No cloning. No deepfakes. ${copy.accentExclusion}`,
      bullets: [
        'Friendly · Professional · Calm · Confident',
        'Natural pauses and back-channelling',
        `${copy.voiceLanguage} voices only — by default`,
      ],
      mockup: 'voice',
    },
    {
      eyebrow: 'Step 3',
      title: 'Get a phone number.',
      body: `Pick a local ${copy.countryAdj} number in the area code your customers expect. Forward your existing line to it with one command from your carrier... or use it as a fresh dedicated number. Live the moment your subscription starts. No SIM cards. No engineer visit.`,
      bullets: [
        `${copy.areaCodeCities} — any ${copy.countryAdj} area code`,
        'Forward your existing number in one carrier command',
        'Live the moment your subscription starts',
      ],
      mockup: 'number',
    },
    {
      eyebrow: 'Step 4',
      title: 'Watch it answer.',
      body: 'Every call recorded. Every word transcribed. Every lead summarised and dropped into your inbox the second the caller hangs up. No call notes to type. No callbacks to chase. You sleep. It answers. You wake up to bookings.',
      bullets: [
        'Real-time call dashboard',
        'Audio recordings stored 90 days',
        'CSV export and CRM integrations',
      ],
      mockup: 'live',
    },
  ];
}

const AFTER_CALL = [
  {
    icon: <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 11a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3z" /></svg>,
    title: 'Transcript on file',
    body: 'Every call gets a word-for-word transcript in your dashboard. Search across them by keyword or caller. Audit-friendly... dispute-proof.',
  },
  {
    icon: <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm10 1H7v2h6V6zM7 10v2h6v-2H7z" /></svg>,
    title: 'Summary in your inbox',
    body: 'A one-paragraph summary lands in your email seconds after the caller hangs up. Reason. Decision. Next step. Done. No call notes to write.',
  },
  {
    icon: <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M4 4a2 2 0 012-2h6.5a2 2 0 011.4.6L17 5.6V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm9 0v3a1 1 0 001 1h3" /></svg>,
    title: 'Booked into your calendar',
    body: 'The receptionist offers slots from your real calendar and confirms the booking on the call. No double bookings. No “I’ll check and call you back.”',
  },
];

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
      style={{ background: 'rgba(var(--agency-accent-rgb), 0.12)', color: 'var(--agency-accent)' }}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-2.5 w-2.5">
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}
