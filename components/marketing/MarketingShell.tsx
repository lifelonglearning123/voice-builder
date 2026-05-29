import Link from 'next/link';
import type { ReactNode } from 'react';
import type { MarketingAgency } from '@/lib/agency/marketing';
import { agencyStyle } from '@/lib/agency/marketing';

interface MarketingShellProps {
  agency: MarketingAgency;
  /** If signed in, the top-right CTA points to /dashboard instead of /signup. */
  signedIn: boolean;
  /** Active nav route — adds an underline / weight to the matching link. */
  activeRoute?: 'home' | 'how' | 'pricing' | 'faq';
  children: ReactNode;
}

const NAV: Array<{ key: NonNullable<MarketingShellProps['activeRoute']>; label: string; href: string }> = [
  { key: 'how', label: 'How it works', href: '/how-it-works' },
  { key: 'pricing', label: 'Pricing', href: '/pricing' },
  { key: 'faq', label: 'FAQ', href: '/faq' },
];

export function MarketingShell({ agency, signedIn, activeRoute, children }: MarketingShellProps) {
  return (
    <div className="marketing-canvas relative isolate min-h-screen" style={agencyStyle(agency)}>
      <TopNav agency={agency} signedIn={signedIn} activeRoute={activeRoute} />
      <main>{children}</main>
      <Footer agency={agency} />
    </div>
  );
}

function TopNav({
  agency,
  signedIn,
  activeRoute,
}: {
  agency: MarketingAgency;
  signedIn: boolean;
  activeRoute?: MarketingShellProps['activeRoute'];
}) {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md">
      <div
        className="absolute inset-0 -z-10 border-b border-slate-900/[0.06]"
        style={{ background: 'rgba(251,251,253,0.78)' }}
      />
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          {agency.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agency.logoUrl}
              alt={agency.name}
              className="h-7 w-auto max-w-[160px] object-contain"
            />
          ) : (
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
              style={{ background: 'var(--agency-accent)' }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M10 2a4 4 0 00-4 4v4a4 4 0 008 0V6a4 4 0 00-4-4zM5 11a5 5 0 0010 0h-1.5a3.5 3.5 0 01-7 0H5zm5 6.5c-.41 0-.75-.34-.75-.75v-1.5a.75.75 0 011.5 0v1.5c0 .41-.34.75-.75.75z" />
              </svg>
            </span>
          )}
          <span className="font-semibold tracking-tight text-slate-900">{agency.name}</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => {
            const active = item.key === activeRoute;
            return (
              <Link
                key={item.key}
                href={item.href as never}
                className={
                  'text-sm tracking-tight transition-colors ' +
                  (active
                    ? 'font-medium text-slate-900'
                    : 'text-slate-600 hover:text-slate-900')
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {signedIn ? (
            <Link href={'/dashboard' as never} className="marketing-pill text-sm">
              Go to dashboard
              <ArrowIcon />
            </Link>
          ) : (
            <>
              <Link
                href={'/login' as never}
                className="hidden text-sm font-medium tracking-tight text-slate-600 hover:text-slate-900 sm:inline-flex"
              >
                Sign in
              </Link>
              <Link href={'/signup' as never} className="marketing-pill text-sm">
                Get started
                <ArrowIcon />
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

function Footer({ agency }: { agency: MarketingAgency }) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-900/[0.06] bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2.5">
            {agency.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agency.logoUrl} alt={agency.name} className="h-7 w-auto max-w-[160px]" />
            ) : (
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
                style={{ background: 'var(--agency-accent)' }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M10 2a4 4 0 00-4 4v4a4 4 0 008 0V6a4 4 0 00-4-4zM5 11a5 5 0 0010 0h-1.5a3.5 3.5 0 01-7 0H5zm5 6.5c-.41 0-.75-.34-.75-.75v-1.5a.75.75 0 011.5 0v1.5c0 .41-.34.75-.75.75z" />
                </svg>
              </span>
            )}
            <span className="font-semibold tracking-tight text-slate-900">{agency.name}</span>
          </div>
          <p className="mt-4 max-w-sm text-sm tracking-tight text-slate-600">
            AI receptionists that answer every call, capture every lead, and book the
            right next step — for {agency.isFallback ? 'small businesses' : 'your business'}.
          </p>
        </div>

        <div>
          <p className="font-mono-tight text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Product
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href={'/how-it-works' as never} className="text-slate-600 hover:text-slate-900">How it works</Link></li>
            <li><Link href={'/pricing' as never} className="text-slate-600 hover:text-slate-900">Pricing</Link></li>
            <li><Link href={'/faq' as never} className="text-slate-600 hover:text-slate-900">FAQ</Link></li>
          </ul>
        </div>

        <div>
          <p className="font-mono-tight text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Account
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href={'/login' as never} className="text-slate-600 hover:text-slate-900">Sign in</Link></li>
            <li><Link href={'/signup' as never} className="text-slate-600 hover:text-slate-900">Get started</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-900/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-6 py-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <p>© {year} {agency.name}. All rights reserved.</p>
          <p className="font-mono-tight tracking-tight">
            Built on AI you can trust · Voice-first
          </p>
        </div>
      </div>
    </footer>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
