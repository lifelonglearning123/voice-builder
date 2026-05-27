import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMarketingAgency, formatPrice } from '@/lib/agency/marketing';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { AudioPlayer, type AudioSample } from '@/components/marketing/AudioPlayer';
import { Reveal, RevealGroup } from '@/components/marketing/Reveal';

export const runtime = 'nodejs';

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, agency] = await Promise.all([
    supabase.auth.getUser(),
    getMarketingAgency(),
  ]);

  const samples: AudioSample[] = [
    {
      id: 'plumber',
      label: 'Emergency call-out',
      description:
        '6:42pm — a customer with a burst pipe gets booked in for first thing tomorrow, with the engineer notified.',
      src: '/voice-samples/marketing/plumber.mp3',
    },
    {
      id: 'dental',
      label: 'New patient enquiry',
      description:
        'A first-time patient asks about Invisalign, gets pricing, and books a consultation — all without reception.',
      src: '/voice-samples/marketing/dental.mp3',
    },
    {
      id: 'agency',
      label: 'After-hours lead',
      description:
        'Wednesday 10:14pm — a serious enquiry gets qualified, captured, and emailed to sales before the team starts work.',
      src: '/voice-samples/marketing/agency.mp3',
    },
  ];

  const price = formatPrice(agency.pricePence, agency.currency);

  return (
    <MarketingShell agency={agency} signedIn={!!user} activeRoute="home">
      {/* ============================================================
       *  HERO
       * ============================================================ */}
      <section className="relative overflow-hidden">
        <div className="hero-glow" aria-hidden />
        <div className="bg-fine-grid absolute inset-0 -z-10" aria-hidden />

        <div className="mx-auto max-w-7xl px-6 pb-24 pt-20 md:pb-32 md:pt-28">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr,1fr]">
            <div>
              <Reveal>
                <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  AI Receptionist · Always on
                </p>
              </Reveal>
              <Reveal delayMs={80}>
                <h1 className="display-headline mt-5 text-[clamp(2.75rem,7vw,5.75rem)] text-slate-900">
                  Never miss<br />another call.
                </h1>
              </Reveal>
              <Reveal delayMs={160}>
                <p className="mt-6 max-w-xl text-lg leading-snug tracking-tight text-slate-600 md:text-xl">
                  A voice that sounds human. A receptionist that books, qualifies and
                  follows up — answering inside three rings, twenty-four hours a day.
                  Ready in twelve minutes.
                </p>
              </Reveal>
              <Reveal delayMs={240}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link
                    href={user ? '/dashboard' as never : '/signup' as never}
                    className="marketing-pill"
                  >
                    {user ? 'Go to dashboard' : 'Start free'}
                    <ArrowIcon />
                  </Link>
                  <a href="#hear-it" className="marketing-pill marketing-pill--ghost">
                    Hear it in action
                  </a>
                </div>
              </Reveal>
              <Reveal delayMs={320}>
                <div className="mt-10 flex items-center gap-6 text-xs tracking-tight text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <DotIcon /> No code
                  </span>
                  <span className="flex items-center gap-1.5">
                    <DotIcon /> No phone hardware
                  </span>
                  <span className="flex items-center gap-1.5">
                    <DotIcon /> Cancel anytime
                  </span>
                </div>
              </Reveal>
            </div>

            <Reveal delayMs={200}>
              <div id="hear-it">
                <AudioPlayer samples={samples} />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ============================================================
       *  TRUST STRIP — big numbers
       * ============================================================ */}
      <section className="border-y border-slate-900/[0.06] bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <RevealGroup className="grid gap-12 md:grid-cols-3">
            <Reveal>
              <div>
                <p className="stat-number">24/7</p>
                <p className="mt-3 text-sm tracking-tight text-slate-600">
                  Answers every call — including 6am Saturday and 11pm
                  Wednesday. Your competitors don&apos;t.
                </p>
              </div>
            </Reveal>
            <Reveal>
              <div>
                <p className="stat-number">&lt; 3s</p>
                <p className="mt-3 text-sm tracking-tight text-slate-600">
                  Picks up before three rings. No hold music. No voicemail
                  that nobody listens to.
                </p>
              </div>
            </Reveal>
            <Reveal>
              <div>
                <p className="stat-number">12 min</p>
                <p className="mt-3 text-sm tracking-tight text-slate-600">
                  From sign-up to live phone number. Describe your business
                  in plain English; the AI learns the rest.
                </p>
              </div>
            </Reveal>
          </RevealGroup>
        </div>
      </section>

      {/* ============================================================
       *  HOW IT WORKS
       * ============================================================ */}
      <section className="relative">
        <div className="mx-auto max-w-7xl px-6 py-28">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              How it works
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h2 className="display-headline-sm mt-4 max-w-2xl text-4xl text-slate-900 md:text-6xl">
              Four steps.<br />
              <span className="text-slate-400">Then it&apos;s answering.</span>
            </h2>
          </Reveal>

          <RevealGroup className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <Reveal key={step.title}>
                <div className="marketing-card flex h-full flex-col p-7">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium"
                    style={{
                      background: 'rgba(var(--agency-accent-rgb), 0.08)',
                      color: 'var(--agency-accent)',
                    }}
                  >
                    {i + 1}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed tracking-tight text-slate-600">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </RevealGroup>

          <Reveal delayMs={200}>
            <div className="mt-12">
              <Link
                href={'/how-it-works' as never}
                className="inline-flex items-center gap-1.5 text-sm font-medium tracking-tight text-slate-900 hover:opacity-70"
              >
                See the full walkthrough <ArrowIcon />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================================================
       *  THREE PROOF POINTS — wide split sections
       * ============================================================ */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-28">
          <div className="space-y-28">
            <ProofRow
              eyebrow="Sounds human"
              headline="A voice that doesn't tell."
              body="Customers ask if they're speaking to a person. They're not. Pauses, intonation, back-channelling — the AI handles the parts of a conversation that make it feel real, without pretending to be one."
              imageRight={false}
            />
            <ProofRow
              eyebrow="Takes action"
              headline="Books. Qualifies. Hands off."
              body="It doesn't just chat. It books appointments into your calendar, captures lead details into your CRM, and pushes the call summary to whoever needs it. The work happens during the call, not after."
              imageRight={true}
            />
            <ProofRow
              eyebrow="Learns your business"
              headline="Trained on you, not the internet."
              body="Describe your services, working hours and the questions customers always ask. The AI absorbs your knowledge base and only answers from it — no hallucinated prices, no off-brand replies."
              imageRight={false}
            />
          </div>
        </div>
      </section>

      {/* ============================================================
       *  INDUSTRIES TEASER
       * ============================================================ */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-28">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Industries
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h2 className="display-headline-sm mt-4 max-w-3xl text-4xl text-slate-900 md:text-6xl">
              Working in plumbing,<br />
              dentistry, lettings or law?<br />
              <span className="text-slate-400">It already knows your script.</span>
            </h2>
          </Reveal>

          <RevealGroup className="mt-14 grid grid-cols-2 gap-3 md:grid-cols-4">
            {INDUSTRIES_TEASER.map((ind) => (
              <Reveal key={ind.label}>
                <Link
                  href={'/industries' as never}
                  className="marketing-card flex items-center justify-between p-5"
                >
                  <span className="text-sm font-medium tracking-tight text-slate-900">
                    {ind.label}
                  </span>
                  <span className="text-slate-400">
                    <ArrowIcon />
                  </span>
                </Link>
              </Reveal>
            ))}
          </RevealGroup>

          <Reveal delayMs={200}>
            <div className="mt-10">
              <Link
                href={'/industries' as never}
                className="inline-flex items-center gap-1.5 text-sm font-medium tracking-tight text-slate-900 hover:opacity-70"
              >
                Explore all industries <ArrowIcon />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================================================
       *  PRICING CARD
       * ============================================================ */}
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-6 py-28 text-center">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              One simple price
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h2 className="display-headline-sm mt-4 text-4xl text-slate-900 md:text-6xl">
              {price} per month.<br />
              <span className="text-slate-400">No setup. No surprises.</span>
            </h2>
          </Reveal>
          <Reveal delayMs={160}>
            <p className="mx-auto mt-6 max-w-xl text-base leading-snug tracking-tight text-slate-600 md:text-lg">
              One dedicated phone number, unlimited inbound minutes within fair use,
              all calls recorded, transcripts emailed, integrations included. Cancel
              from the dashboard any time.
            </p>
          </Reveal>
          <Reveal delayMs={240}>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link
                href={user ? '/dashboard' as never : '/signup' as never}
                className="marketing-pill"
              >
                {user ? 'Go to dashboard' : 'Start free'}
                <ArrowIcon />
              </Link>
              <Link href={'/pricing' as never} className="marketing-pill marketing-pill--ghost">
                See what&apos;s included
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================================================
       *  FINAL CTA
       * ============================================================ */}
      <section className="relative overflow-hidden border-t border-slate-900/[0.06]">
        <div className="hero-glow" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 py-32 text-center">
          <Reveal>
            <h2 className="display-headline text-[clamp(2.5rem,6vw,5rem)] text-slate-900">
              Twelve minutes from now,<br />
              your phone could be<br />
              <span style={{ color: 'var(--agency-accent)' }}>answering itself.</span>
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
              <a href="#hear-it" className="marketing-pill marketing-pill--ghost">
                Listen first
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}

function ProofRow({
  eyebrow,
  headline,
  body,
  imageRight,
}: {
  eyebrow: string;
  headline: string;
  body: string;
  imageRight: boolean;
}) {
  return (
    <Reveal>
      <div
        className={
          'grid items-center gap-12 lg:grid-cols-2 lg:gap-20 ' +
          (imageRight ? '' : 'lg:[&>*:first-child]:order-2')
        }
      >
        <div>
          <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
            {eyebrow}
          </p>
          <h3 className="display-headline-sm mt-4 text-3xl text-slate-900 md:text-5xl">
            {headline}
          </h3>
          <p className="mt-5 max-w-lg text-base leading-snug tracking-tight text-slate-600 md:text-lg">
            {body}
          </p>
        </div>
        <ProductMockup variant={imageRight ? 'call' : 'transcript'} />
      </div>
    </Reveal>
  );
}

// Stylised CSS product mockup — used until real screenshots are dropped in.
function ProductMockup({ variant }: { variant: 'call' | 'transcript' }) {
  if (variant === 'call') {
    return (
      <div className="relative">
        <div className="hero-glow" aria-hidden />
        <div className="relative overflow-hidden rounded-[28px] border border-slate-900/8 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_60px_rgba(15,23,42,0.08)]">
          {/* Mock browser chrome */}
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
            <span className="ml-3 font-mono-tight text-[10px] text-slate-400">
              dashboard / live call
            </span>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono-tight text-[10px] uppercase tracking-[0.18em] text-slate-400">
                  In-call · 00:42
                </p>
                <p className="mt-2 font-semibold tracking-tight text-slate-900">
                  Sarah · New patient enquiry
                </p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            </div>
            {/* Waveform mock */}
            <div className="mt-6 flex h-16 items-center gap-[3px]">
              {[20, 30, 45, 60, 50, 38, 55, 70, 80, 65, 50, 40, 55, 72, 88, 75, 60, 45, 30, 22, 35, 50, 65, 80, 70, 55, 40, 30, 20].map((h, i) => (
                <span
                  key={i}
                  className="inline-block w-[3px] rounded-full"
                  style={{
                    height: `${h}%`,
                    background: 'var(--agency-accent)',
                    opacity: 0.4 + (h / 100) * 0.6,
                  }}
                />
              ))}
            </div>
            {/* Captured fields */}
            <div className="mt-6 space-y-2">
              {[
                ['Caller', 'Sarah Mitchell'],
                ['Phone', '+44 7700 900 144'],
                ['Reason', 'Invisalign consultation'],
                ['Booked', 'Thu 28 May · 10:30'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-medium tracking-tight text-slate-900">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="hero-glow" aria-hidden />
      <div className="relative overflow-hidden rounded-[28px] border border-slate-900/8 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_60px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-100 px-6 py-4">
          <p className="font-mono-tight text-[10px] uppercase tracking-[0.18em] text-slate-400">
            Transcript · 1m 14s
          </p>
        </div>
        <div className="space-y-4 p-6 text-sm leading-relaxed">
          <div>
            <p className="font-mono-tight text-[10px] uppercase tracking-[0.18em] text-slate-400">AI</p>
            <p className="mt-1 tracking-tight text-slate-700">
              &ldquo;Good afternoon, thanks for calling. How can I help today?&rdquo;
            </p>
          </div>
          <div>
            <p className="font-mono-tight text-[10px] uppercase tracking-[0.18em] text-slate-400">Caller</p>
            <p className="mt-1 tracking-tight text-slate-700">
              Hi, my boiler&apos;s making a banging noise — is there someone who could
              come out tomorrow?
            </p>
          </div>
          <div>
            <p className="font-mono-tight text-[10px] uppercase tracking-[0.18em] text-slate-400">AI</p>
            <p className="mt-1 tracking-tight text-slate-700">
              &ldquo;Of course. Could I take your postcode so I can check engineer
              availability in your area?&rdquo;
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-[12px] tracking-tight text-emerald-800">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z"
                clipRule="evenodd"
              />
            </svg>
            Job booked · Engineer Mark · Tue 27 May · 8:30am
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotIcon() {
  return (
    <span
      aria-hidden
      className="inline-block h-1 w-1 rounded-full"
      style={{ background: 'var(--agency-accent)' }}
    />
  );
}

const STEPS = [
  {
    title: 'Describe your business',
    body: 'Two sentences and your website URL. The AI reads everything and drafts a receptionist that already knows your services, hours, and tone.',
  },
  {
    title: 'Pick a voice',
    body: 'Choose from four production-grade voices. Preview them in the wizard before you commit. Switch later if your customers prefer a different one.',
  },
  {
    title: 'Plug it in',
    body: 'A UK phone number is provisioned in seconds. Point your existing line to it, or use it as a new dedicated number. No carrier paperwork.',
  },
  {
    title: 'Watch it answer',
    body: 'Every call is recorded, transcribed, and summarised. Lead details land in your inbox or your CRM the moment the caller hangs up.',
  },
];

const INDUSTRIES_TEASER = [
  { label: 'Plumbing & heating' },
  { label: 'Dental practices' },
  { label: 'Estate agents' },
  { label: 'Law firms' },
  { label: 'Beauty & spa' },
  { label: 'Trades & contractors' },
  { label: 'Vet practices' },
  { label: 'Agencies' },
];
