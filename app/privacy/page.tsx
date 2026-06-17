import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMarketingAgency } from '@/lib/agency/marketing';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { Reveal } from '@/components/marketing/Reveal';

export const runtime = 'nodejs';

export default async function PrivacyPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, agency] = await Promise.all([
    supabase.auth.getUser(),
    getMarketingAgency(),
  ]);

  const brand = agency.name;
  const effectiveDate = 'June 17, 2026';

  return (
    <MarketingShell agency={agency} signedIn={!!user}>
      <section className="relative overflow-hidden">
        <div className="hero-glow" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 pb-12 pt-24 text-center md:pt-32">
          <Reveal>
            <p className="font-mono-tight text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Legal
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <h1 className="display-headline mt-5 text-[clamp(2.5rem,6vw,4.5rem)] text-slate-900">
              Privacy Policy
            </h1>
          </Reveal>
          <Reveal delayMs={160}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-snug tracking-tight text-slate-600">
              How {brand} collects, uses, and protects information when you use
              our service.
            </p>
            <p className="mt-3 text-sm text-slate-500">Effective {effectiveDate}</p>
          </Reveal>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-24">
          <article className="space-y-10 text-[15px] leading-relaxed tracking-tight text-slate-700">
            <Section title="1. Who we are">
              <p>
                {brand} provides AI-powered phone receptionist services for
                small businesses. This policy explains what data we collect
                when you sign up for an account, configure a receptionist, or
                receive calls through the service — and how we handle it.
              </p>
              <p>
                If you have any questions about this policy, contact us at the
                support address listed in your dashboard.
              </p>
            </Section>

            <Section title="2. Information we collect">
              <p>We collect three categories of data:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Account information</strong> — the name, email
                  address, business details, and billing information you
                  provide when you sign up or update your account.
                </li>
                <li>
                  <strong>Receptionist configuration</strong> — the business
                  description, knowledge base, voice selection, opening
                  script, and any other settings you provide so the
                  receptionist can answer calls on your behalf.
                </li>
                <li>
                  <strong>Call data</strong> — audio recordings, transcripts,
                  caller phone numbers, call timestamps, and any details a
                  caller shares during a conversation (such as their name,
                  contact information, and reason for calling).
                </li>
              </ul>
            </Section>

            <Section title="3. How we use your information">
              <p>We use the information we collect to:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Operate, maintain, and improve the {brand} service.</li>
                <li>Answer calls on your behalf and deliver transcripts, recordings, and lead details to you.</li>
                <li>Process payments and prevent fraud.</li>
                <li>Send service notifications, billing emails, and security alerts.</li>
                <li>Comply with legal obligations and enforce our terms.</li>
              </ul>
              <p>
                We do <strong>not</strong> use your call recordings, transcripts,
                or configuration to train AI models — ours or anyone else&apos;s.
              </p>
            </Section>

            <Section title="4. Call recordings and caller notice">
              <p>
                When a call is answered by your receptionist, the AI is
                instructed to disclose that it is an AI when asked. Call
                recordings and transcripts are stored on your behalf in
                encrypted storage and made available to you in the dashboard.
              </p>
              <p>
                Recordings are retained for up to 90 days by default and then
                automatically deleted, unless you have configured a different
                retention period or downloaded them. You can delete a recording
                on demand from the dashboard.
              </p>
              <p>
                You are responsible for ensuring that call recording and AI
                disclosure comply with the laws of the jurisdictions in which
                your callers are located.
              </p>
            </Section>

            <Section title="5. How we share information">
              <p>We share information only in these limited circumstances:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Service providers</strong> — telephony carriers,
                  cloud hosting, payment processors, AI model providers, and
                  email delivery services that we use to operate the service.
                  Each is bound by a written agreement.
                </li>
                <li>
                  <strong>Your integrations</strong> — when you connect a
                  calendar, CRM, or webhook destination, we send the relevant
                  call and lead data to those systems on your instruction.
                </li>
                <li>
                  <strong>Legal requirements</strong> — when we are required
                  by law, court order, or regulatory request, or to protect
                  the rights and safety of {brand}, our customers, or the
                  public.
                </li>
              </ul>
              <p>
                We do not sell your personal information or your callers&apos;
                personal information.
              </p>
            </Section>

            <Section title="6. Data retention">
              <p>
                Account and billing information is kept for as long as you have
                an account with us and for a reasonable period afterwards to
                meet legal and accounting obligations.
              </p>
              <p>
                Call recordings and transcripts are retained for up to 90 days
                by default. Lead and contact data captured on calls is retained
                for as long as your account is active, so it remains available
                in your CRM and dashboard.
              </p>
              <p>
                If you close your account, we delete your data within a
                reasonable period, except where we are required to retain it
                for legal, fraud-prevention, or dispute-resolution purposes.
              </p>
            </Section>

            <Section title="7. Security">
              <p>
                We use industry-standard technical and organisational measures
                to protect your data — including encryption in transit and at
                rest, access controls, and regular security reviews. No system
                is perfectly secure, but we take reasonable steps to reduce
                risk and respond quickly to incidents.
              </p>
            </Section>

            <Section title="8. Your rights">
              <p>
                Depending on where you live, you may have rights to access,
                correct, export, or delete your personal information, or to
                object to or restrict certain processing. You can exercise most
                of these rights directly from your dashboard, or by contacting
                support.
              </p>
              <p>
                If you are a caller (not an account holder) and want to access
                or delete information collected about you, please contact the
                business that operates the phone number you called — they are
                the data controller for that information. We will support them
                in responding to your request.
              </p>
            </Section>

            <Section title="9. International transfers">
              <p>
                We may process and store data in countries other than your
                own. Where required, we use appropriate safeguards (such as
                standard contractual clauses) to protect data transferred
                internationally.
              </p>
            </Section>

            <Section title="10. Children">
              <p>
                {brand} is a business service and is not directed to children
                under 16. We do not knowingly collect personal information
                from children.
              </p>
            </Section>

            <Section title="11. Changes to this policy">
              <p>
                We may update this policy from time to time. When we do, we
                will update the effective date at the top of this page and, if
                the changes are significant, notify you by email or in the
                dashboard.
              </p>
            </Section>

            <Section title="12. Contact">
              <p>
                Questions, requests, or concerns? Reach out to us at the
                support address shown in your {brand} dashboard. We will
                respond within a reasonable timeframe.
              </p>
            </Section>
          </article>

          <Reveal>
            <div className="mt-16 flex flex-wrap justify-center gap-3">
              <Link
                href={user ? '/dashboard' as never : '/signup' as never}
                className="marketing-pill"
              >
                {user ? 'Go to dashboard' : 'Get started'}
                <ArrowIcon />
              </Link>
              <Link href={'/faq' as never} className="marketing-pill marketing-pill--ghost">
                Read the FAQ
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <section>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        <div className="mt-4 space-y-4">{children}</div>
      </section>
    </Reveal>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
