import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMarketingAgency, formatPrice } from '@/lib/agency/marketing';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { Reveal, RevealGroup } from '@/components/marketing/Reveal';

export const runtime = 'nodejs';

export default async function PricingPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, agency] = await Promise.all([
    supabase.auth.getUser(),
    getMarketingAgency(),
  ]);

  const price = formatPrice(agency.pricePence, agency.currency);

  return (
    <MarketingShell agency={agency} signedIn={!!user} activeRoute="pricing">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 pb-16 pt-24 text-center md:pt-32">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Pricing
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h1 className="display-headline mt-5 text-[clamp(2.75rem,6.5vw,5rem)] text-slate-900">
              One price.<br />
              <span className="text-slate-400">Everything in.</span>
            </h1>
          </Reveal>
          <Reveal delayMs={160}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-snug tracking-tight text-slate-600">
              No setup fee. No per-minute charges. No tiers. No feature gates.
              No three-month contract. Two clicks from your dashboard cancels it...
              and you keep service until the end of the month you paid for.
            </p>
          </Reveal>
        </div>
      </section>

      {/* The card */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-24">
          <Reveal>
            <div
              className="relative overflow-hidden rounded-[28px] border border-slate-900/8 bg-white p-10 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_60px_rgba(15,23,42,0.08)] md:p-14"
              style={{
                backgroundImage:
                  'radial-gradient(60% 40% at 50% 0%, rgba(var(--agency-accent-rgb), 0.06), transparent 70%)',
              }}
            >
              <div className="flex items-baseline gap-3">
                <span className="display-headline text-6xl text-slate-900 md:text-8xl">
                  {price}
                </span>
                <span className="text-lg tracking-tight text-slate-500">/ month</span>
              </div>
              <p className="mt-3 text-sm tracking-tight text-slate-500">
                Billed in {agency.currency}. Includes VAT for UK customers.
              </p>

              <div className="my-10 hairline" />

              <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
                What&apos;s included
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm tracking-tight text-slate-700">
                    <CheckIcon />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-10 flex flex-wrap items-center gap-3">
                <Link
                  href={user ? '/dashboard' as never : '/signup' as never}
                  className="marketing-pill"
                >
                  {user ? 'Go to dashboard' : 'Start free'}
                  <ArrowIcon />
                </Link>
                <Link href={'/how-it-works' as never} className="marketing-pill marketing-pill--ghost">
                  See how it works
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ROI Math */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              The maths
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h2 className="display-headline-sm mt-4 max-w-2xl text-4xl text-slate-900 md:text-6xl">
              One booked job a month.<br />
              <span className="text-slate-400">That&apos;s the maths.</span>
            </h2>
          </Reveal>
          <Reveal delayMs={160}>
            <p className="mt-6 max-w-2xl text-base leading-snug tracking-tight text-slate-600 md:text-lg">
              The average UK SMB misses one in five inbound calls. Evenings. Weekends.
              Lunch. Busy spells. The school run. Each one a customer who dialled the
              next name in Google before you could call back. Catch one of them per
              month... and the receptionist&apos;s already paid for itself twice over.
            </p>
          </Reveal>

          <RevealGroup className="mt-14 grid gap-6 md:grid-cols-3">
            {ROI_CARDS.map((c) => (
              <Reveal key={c.title}>
                <div className="marketing-card h-full p-7">
                  <p className="stat-number text-[3rem] md:text-[3.5rem]">{c.stat}</p>
                  <p className="mt-3 text-sm font-medium tracking-tight text-slate-900">
                    {c.title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed tracking-tight text-slate-600">
                    {c.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* Compare */}
      <section className="relative">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Compared with the alternatives
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h2 className="display-headline-sm mt-4 text-4xl text-slate-900 md:text-5xl">
              {price}/mo, versus what you&apos;re doing now.
            </h2>
          </Reveal>

          <Reveal delayMs={160}>
            <div className="mt-12 overflow-hidden rounded-2xl border border-slate-900/8 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/80 text-[12px] uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-5 py-4 font-medium">Option</th>
                    <th className="px-5 py-4 font-medium">Hours covered</th>
                    <th className="px-5 py-4 font-medium">Monthly cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {COMPARE_ROWS.map((row) => {
                    const cost = row.cost === '__price__' ? `${price}/mo` : row.cost;
                    return (
                      <tr key={row.option} className={row.highlight ? 'bg-[rgba(var(--agency-accent-rgb),0.04)]' : ''}>
                        <td className="px-5 py-4 font-medium tracking-tight text-slate-900">{row.option}</td>
                        <td className="px-5 py-4 tracking-tight text-slate-600">{row.hours}</td>
                        <td className="px-5 py-4 font-mono-tight tracking-tight text-slate-900">{cost}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-slate-900/[0.06] bg-white">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <Reveal>
            <h2 className="display-headline-sm text-4xl text-slate-900 md:text-6xl">
              Ready when you are.
            </h2>
          </Reveal>
          <Reveal delayMs={120}>
            <p className="mx-auto mt-5 max-w-xl text-base leading-snug tracking-tight text-slate-600 md:text-lg">
              Twelve minutes from now... your phone could be answering itself.
              Start free. Only pay when you go live. Cancel any time.
            </p>
          </Reveal>
          <Reveal delayMs={200}>
            <div className="mt-8 flex justify-center">
              <Link
                href={user ? '/dashboard' as never : '/signup' as never}
                className="marketing-pill"
              >
                {user ? 'Go to dashboard' : 'Start free'}
                <ArrowIcon />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}

const INCLUDED = [
  'A dedicated UK phone number',
  'Unlimited inbound calls (fair-use cap)',
  'Custom voice & opening line',
  'Full transcripts of every call',
  'Audio recordings, stored 90 days',
  'Caller details emailed instantly',
  'Working-hours and out-of-hours modes',
  'Calendar booking and CRM hand-off',
  'White-glove updates from the wizard',
  'Cancel any time, no contracts',
];

const ROI_CARDS = [
  {
    stat: '1 in 5',
    title: 'Calls you’re missing',
    body: 'Evenings. Weekends. Lunch. The school run. The job already on site. Each ring you don’t reach... is someone calling the next name on Google.',
  },
  {
    stat: '8 in 10',
    title: 'Won’t leave a voicemail',
    body: 'They hang up. They scroll. They book your competitor. And you never know they tried. Voicemail isn’t a safety net — it’s a leak.',
  },
  {
    stat: '£0',
    title: 'Setup. Hardware. Contracts.',
    body: 'No phone system to buy. No minimum term. No per-minute charges. Run it for a month and stop if it isn’t for you... no questions asked.',
  },
];

const COMPARE_ROWS = [
  { option: 'Live receptionist (part-time)', hours: 'Mon–Fri, 9–5', cost: '£900+', highlight: false },
  { option: 'Answering service', hours: '24/7 (reads a script)', cost: '£250–£600', highlight: false },
  { option: 'Voicemail', hours: '24/7 (8 in 10 hang up)', cost: '£0', highlight: false },
  { option: 'This AI receptionist', hours: '24/7 (books the job)', cost: '__price__', highlight: true },
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
