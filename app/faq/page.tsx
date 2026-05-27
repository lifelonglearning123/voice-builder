import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMarketingAgency, formatPrice } from '@/lib/agency/marketing';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { Reveal } from '@/components/marketing/Reveal';

export const runtime = 'nodejs';

export default async function FaqPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, agency] = await Promise.all([
    supabase.auth.getUser(),
    getMarketingAgency(),
  ]);
  const price = formatPrice(agency.pricePence, agency.currency);

  const sections = buildFaqs(price);

  return (
    <MarketingShell agency={agency} signedIn={!!user} activeRoute="faq">
      <section className="relative overflow-hidden">
        <div className="hero-glow" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 pb-16 pt-24 text-center md:pt-32">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Frequently asked
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h1 className="display-headline mt-5 text-[clamp(2.75rem,6.5vw,5rem)] text-slate-900">
              The questions<br />
              <span className="text-slate-400">everyone asks first.</span>
            </h1>
          </Reveal>
          <Reveal delayMs={160}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-snug tracking-tight text-slate-600">
              If you have a question that isn&apos;t answered here, ask the AI
              receptionist on a sample call — it has been trained on these too.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-24">
          {sections.map((section) => (
            <Reveal key={section.title}>
              <div className="mt-14 first:mt-0">
                <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  {section.title}
                </p>
                <div className="mt-5 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
                  {section.items.map((item) => (
                    <details key={item.q} className="group p-6 marker:hidden [&_summary::-webkit-details-marker]:hidden">
                      <summary className="flex cursor-pointer items-start justify-between gap-6 text-left">
                        <span className="text-base font-medium tracking-tight text-slate-900">
                          {item.q}
                        </span>
                        <span className="mt-0.5 shrink-0 text-slate-400 faq-chevron">
                          <ChevronIcon />
                        </span>
                      </summary>
                      <div className="mt-3 text-[15px] leading-relaxed tracking-tight text-slate-600">
                        {item.a}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA strip */}
      <section className="border-t border-slate-900/[0.06] bg-white">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <Reveal>
            <h2 className="display-headline-sm text-3xl text-slate-900 md:text-5xl">
              Still wondering?<br />
              <span className="text-slate-400">Try it for the cost of a coffee.</span>
            </h2>
          </Reveal>
          <Reveal delayMs={120}>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href={user ? '/dashboard' as never : '/signup' as never}
                className="marketing-pill"
              >
                {user ? 'Go to dashboard' : 'Start free'}
                <ArrowIcon />
              </Link>
              <Link href={'/how-it-works' as never} className="marketing-pill marketing-pill--ghost">
                How it works
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}

function buildFaqs(price: string) {
  return [
    {
      title: 'Getting started',
      items: [
        {
          q: 'How long does setup take?',
          a: 'About twelve minutes for most businesses. You describe what you do in plain English, the AI drafts a receptionist based on your description plus your website, you pick a voice and a phone number, and it activates the moment your subscription starts.',
        },
        {
          q: 'Do I need to write a script?',
          a: 'No. The AI reads your website and your two-line description, then drafts the conversation flow itself. You can edit anything it gets wrong before going live — but most businesses go live with the draft as-is.',
        },
        {
          q: 'Can I use my existing phone number?',
          a: 'You keep your existing number. We provision a new one and you forward your existing line to it from your carrier — a single command. Calls still come into your existing number; the AI just answers them.',
        },
      ],
    },
    {
      title: 'Pricing & billing',
      items: [
        {
          q: 'Are there setup fees or per-minute charges?',
          a: `No. ${price} per month covers a dedicated phone number, unlimited inbound calls within fair use, transcripts, recordings, and integrations. Nothing else to add on.`,
        },
        {
          q: 'Can I cancel any time?',
          a: 'Yes. Two clicks from your dashboard. You keep service until the end of the billing period, then it stops — no exit fees, no notice period.',
        },
        {
          q: 'What happens if I miss a payment?',
          a: 'You get a few days grace. We&apos;ll email you the moment a payment fails so you can update your card — the receptionist keeps answering during that window. If the payment isn&apos;t resolved, service pauses, but your data and configuration are preserved.',
        },
      ],
    },
    {
      title: 'How it sounds',
      items: [
        {
          q: 'Will customers know they’re talking to AI?',
          a: 'If they ask, the receptionist tells them — it’s instructed never to pretend to be human. But the voice is good enough that most callers don’t ask. Listen to the samples on the homepage.',
        },
        {
          q: 'What language and accent does it use?',
          a: 'UK English with a choice of four voices — friendly, professional, calm, or confident. We don’t use American voices on UK businesses by default.',
        },
        {
          q: 'Can it sound like our existing receptionist?',
          a: 'You pick from four production voices; we don’t clone real people’s voices (that’s a deepfake risk and we won’t do it). But the receptionist learns your business’ tone, vocabulary, and opening line.',
        },
      ],
    },
    {
      title: 'What it can do',
      items: [
        {
          q: 'Does it book appointments?',
          a: 'Yes — straight into your calendar (Google Calendar, Office 365, or any iCal feed). It offers slots from your real availability, confirms on the call, and sends a confirmation email/SMS.',
        },
        {
          q: 'Can it transfer to a human?',
          a: 'It will take a detailed message and pass it to the right person. Live transfer to a human while the caller waits is intentionally not enabled — most SMBs don’t have someone to transfer TO, and live transfers introduce edge-case failures we don’t want.',
        },
        {
          q: 'What integrations does it have?',
          a: 'Calendar (Google, Office 365, iCal), email (any inbox), CRMs via webhook (HubSpot, Pipedrive, monday.com, GoHighLevel, custom). Lead details flow in real time as the call ends.',
        },
      ],
    },
    {
      title: 'Privacy & safety',
      items: [
        {
          q: 'Where are call recordings stored?',
          a: 'In encrypted EU storage for 90 days, then automatically deleted. You can download recordings any time, or delete on demand. We don’t use your call data to train models.',
        },
        {
          q: 'Can the AI make up information?',
          a: 'It’s instructed to answer only from your provided knowledge base. If a caller asks something we don’t have an answer for, the AI takes a message instead of guessing. You can review the transcript afterwards to expand the knowledge base.',
        },
        {
          q: 'What about GDPR and caller consent?',
          a: 'Calls open with an AI-disclosure prompt. Recordings are explicitly opted-in by you (the business). Caller details are stored on your behalf only. GDPR-compliant by default; we can sign a data processing agreement on request.',
        },
      ],
    },
  ];
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
