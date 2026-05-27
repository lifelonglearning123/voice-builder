import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMarketingAgency } from '@/lib/agency/marketing';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { Reveal, RevealGroup } from '@/components/marketing/Reveal';

export const runtime = 'nodejs';

export default async function IndustriesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, agency] = await Promise.all([
    supabase.auth.getUser(),
    getMarketingAgency(),
  ]);

  return (
    <MarketingShell agency={agency} signedIn={!!user} activeRoute="industries">
      <section className="relative overflow-hidden">
        <div className="hero-glow" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 pb-16 pt-24 text-center md:pt-32">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Industries
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h1 className="display-headline mt-5 text-[clamp(2.75rem,6.5vw,5rem)] text-slate-900">
              Built for the calls<br />
              <span className="text-slate-400">your business actually gets.</span>
            </h1>
          </Reveal>
          <Reveal delayMs={160}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-snug tracking-tight text-slate-600">
              Your services. Your prices. Your booking rules. Your tone of voice.
              The AI learns the lot... and only answers from it. Pick the closest
              match below and hear how it handles the kind of caller you actually
              get.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Grid */}
      <section className="relative">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <RevealGroup className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {INDUSTRIES.map((ind) => (
              <Reveal key={ind.slug}>
                <div className="marketing-card flex h-full flex-col p-7">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{
                      background: 'rgba(var(--agency-accent-rgb), 0.08)',
                      color: 'var(--agency-accent)',
                    }}
                  >
                    {ind.icon}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">
                    {ind.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed tracking-tight text-slate-600">
                    {ind.tagline}
                  </p>

                  <p className="mt-5 font-mono-tight text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    Handles
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {ind.handles.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-[13px] tracking-tight text-slate-700">
                        <span
                          className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full"
                          style={{ background: 'var(--agency-accent)' }}
                        />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 flex items-center justify-between">
                    <p className="text-[11px] tracking-tight text-slate-500">
                      Sample call · {ind.sampleDuration}
                    </p>
                    <a
                      href={`/voice-samples/marketing/${ind.slug}.mp3`}
                      className="inline-flex items-center gap-1 text-xs font-medium tracking-tight text-slate-900 hover:opacity-70"
                    >
                      Listen <ArrowIcon />
                    </a>
                  </div>
                </div>
              </Reveal>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* "Not listed?" callout */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Don&apos;t see your industry?
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h2 className="display-headline-sm mt-4 text-4xl text-slate-900 md:text-5xl">
              Anything with a phone line works.
            </h2>
          </Reveal>
          <Reveal delayMs={160}>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-snug tracking-tight text-slate-600 md:text-lg">
              The above are the most common. But the wizard learns whatever you
              describe. Tradespeople. Clinics. Agencies. Schools. Retailers. B2B.
              If your customers pick up the phone... the AI can answer it.
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
                See pricing
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}

const INDUSTRIES = [
  {
    slug: 'plumbing',
    title: 'Plumbing & heating',
    tagline: 'The burst-pipe call at 6pm Sunday. The boiler that died on Christmas Eve. Caught. Triaged. Booked. While you’re still at the dinner table.',
    handles: [
      'Emergency vs routine triage',
      'Address and postcode capture',
      'Day-rate quoting',
    ],
    sampleDuration: '1:14',
    icon: <Icon path="M11 3v6h5l-7 12v-7H4l7-11z" />,
  },
  {
    slug: 'dental',
    title: 'Dental practices',
    tagline: 'New patient asks the Invisalign question reception always fluffs. The AI quotes the right price, books the consult, sends the confirmation. First ring.',
    handles: [
      'New vs existing patient routing',
      'Pricing for common treatments',
      'Online consultation booking',
    ],
    sampleDuration: '1:32',
    icon: <Icon path="M10 2c-2.5 0-4 1.5-4 4 0 1.5.5 2.5 1 4 .5 1.5 1 3 1.5 5 .25 1 .75 1.5 1.5 1.5s1.25-.5 1.5-1.5c.5-2 1-3.5 1.5-5 .5-1.5 1-2.5 1-4 0-2.5-1.5-4-4-4z" />,
  },
  {
    slug: 'estate',
    title: 'Estate agents',
    tagline: 'Sunday 9pm. Applicant scrolling Rightmove from the sofa. They tap call. By the time you’re back at your desk on Monday... the viewing is booked.',
    handles: [
      'Vendor vs applicant routing',
      'Property reference matching',
      'Viewing slot booking',
    ],
    sampleDuration: '1:48',
    icon: <Icon path="M3 9l7-6 7 6v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />,
  },
  {
    slug: 'law',
    title: 'Law firms',
    tagline: 'Triage. Conflict check. Consult booked. Without breaking confidentiality... without making promises... and without your paralegal pulled off chargeable work.',
    handles: [
      'Practice-area triage',
      'Conflict-check intake',
      'Consultation booking',
    ],
    sampleDuration: '1:56',
    icon: <Icon path="M10 3l7 4-7 4-7-4 7-4zM3 11l7 4 7-4M3 15l7 4 7-4" />,
  },
  {
    slug: 'beauty',
    title: 'Beauty & spa',
    tagline: 'Your therapists keep their hands on the client. The phone keeps booking. Last-minute cancellation refills itself before you’ve noticed it opened up.',
    handles: [
      'Treatment-specific booking',
      'Gift voucher and package sales',
      'Last-minute availability check',
    ],
    sampleDuration: '1:08',
    icon: <Icon path="M4 12a6 6 0 0112 0v4H4v-4z M10 4v2" />,
  },
  {
    slug: 'trades',
    title: 'Trades & contractors',
    tagline: 'You’re up a ladder. Your phone’s in the van. The AI takes the details, gives the ballpark, books the site visit. You ring back when you’re back on the ground.',
    handles: [
      'Quote vs urgent job routing',
      'Site address and access capture',
      'Diary slot booking',
    ],
    sampleDuration: '1:22',
    icon: <Icon path="M7 3l3 3-7 7 3 3 7-7 3 3 4-4-9-9-4 4z" />,
  },
  {
    slug: 'vet',
    title: 'Vet practices',
    tagline: 'A panicked owner with a poorly cat. A gentle voice, calm questions, instant triage. Emergencies routed in seconds. Routine bookings handled in the background.',
    handles: [
      'Emergency vs routine triage',
      'Pet records and history capture',
      'Appointment booking',
    ],
    sampleDuration: '1:18',
    icon: <Icon path="M5 8a2 2 0 114 0 2 2 0 01-4 0zm6 0a2 2 0 114 0 2 2 0 01-4 0zM7 14c0-1.5 1.5-3 3-3s3 1.5 3 3v2H7v-2z" />,
  },
  {
    slug: 'agency',
    title: 'Marketing & agencies',
    tagline: 'The tyre-kicker gets filtered out. The real lead gets BANT-qualified... budget, timeline, fit captured during the call... and lands in your inbox as a hot one.',
    handles: [
      'BANT qualification',
      'Industry and size capture',
      'Discovery-call booking',
    ],
    sampleDuration: '2:04',
    icon: <Icon path="M3 5h14v10H3z M7 9h6v2H7z" />,
  },
  {
    slug: 'fitness',
    title: 'Gyms & studios',
    tagline: 'Mid-spin class. Mid-deadlift. The phone keeps ringing — and keeps getting answered. Trial sessions booked. Membership questions handled. Without skipping a rep.',
    handles: [
      'Class and trial booking',
      'Membership pricing',
      'Personal trainer enquiries',
    ],
    sampleDuration: '1:12',
    icon: <Icon path="M3 9h2V7H3v2zm12 0h2V7h-2v2zM5 11h10V9H5v2zM2 9h1m14 0h1" />,
  },
];

function Icon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d={path} />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
