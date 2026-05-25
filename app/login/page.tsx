'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type View =
  | { kind: 'form' }
  | { kind: 'submitting' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

function LoginInner() {
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const urlError = params.get('error');

  const [email, setEmail] = useState('');
  const [view, setView] = useState<View>(
    urlError ? { kind: 'error', message: humanError(urlError) } : { kind: 'form' },
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setView({ kind: 'submitting' });
    try {
      const res = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setView({
          kind: 'error',
          message: data.error || 'We couldn’t send your sign-in email. Please try again.',
        });
        return;
      }
      setView({ kind: 'sent', email: email.trim() });
    } catch (err) {
      setView({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  if (view.kind === 'sent') {
    return (
      <CenteredCard>
        <div className="relative mx-auto flex h-40 w-40 items-center justify-center">
          <div
            className="wizard-aurora"
            style={{ animation: 'aurora-breathe 6s ease-in-out infinite', opacity: 0.7 }}
          />
          <svg
            className="wizard-check relative z-10 h-16 w-16 text-slate-900"
            viewBox="0 0 56 56"
            fill="none"
            stroke="currentColor"
          >
            <circle cx="28" cy="28" r="22" strokeWidth="1.5" opacity="0.4" />
            <path
              d="M18 28.5 L25 35.5 L38 21.5"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p
          className="mt-4 font-mono-tight text-[11px] tracking-[0.18em] text-slate-400 wizard-fade-up"
          style={{ animationDelay: '300ms' }}
        >
          CHECK YOUR EMAIL
        </p>
        <h1
          className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-slate-900 wizard-fade-up"
          style={{ animationDelay: '380ms' }}
        >
          We sent a link to
          <br />
          <span className="text-slate-600">{view.email}</span>
        </h1>
        <p
          className="mt-3 text-sm leading-relaxed text-slate-500 wizard-fade-up"
          style={{ animationDelay: '460ms' }}
        >
          Click it to finish signing in. The link expires in an hour.
        </p>
        <button
          type="button"
          onClick={() => setView({ kind: 'form' })}
          className="mt-6 text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline"
        >
          Use a different email
        </button>
      </CenteredCard>
    );
  }

  const submitting = view.kind === 'submitting';

  return (
    <CenteredCard>
      <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
        VOICE BUILDER
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-900 md:text-4xl">
        Sign in.
      </h1>
      <p className="mt-3 max-w-sm text-base leading-relaxed text-slate-500">
        Enter your email and we&apos;ll send you a magic link. No password to remember.
      </p>

      {view.kind === 'error' && (
        <div className="mt-6 rounded-lg border border-red-100 bg-red-50/50 p-3 text-sm text-red-800">
          {view.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="wizard-focus block w-full rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 transition-colors focus:border-slate-500"
        />
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="wizard-pill w-full justify-center"
        >
          {submitting ? 'Sending…' : 'Send magic link'}
          {!submitting && <span aria-hidden="true">→</span>}
        </button>
      </form>

      <p className="mt-6 text-xs text-slate-400">
        By signing in you agree to your agency&apos;s terms of service.
      </p>

      <p className="mt-8 text-sm text-slate-500">
        Don&apos;t have an account?{' '}
        <Link
          href={'/signup' as never}
          className="font-medium text-slate-700 underline-offset-4 hover:text-slate-900 hover:underline"
        >
          Create one
        </Link>
      </p>

      <Link
        href="/"
        className="mt-6 inline-block text-xs font-medium text-slate-400 underline-offset-4 hover:text-slate-700 hover:underline"
      >
        ← Home
      </Link>
    </CenteredCard>
  );
}

export default function LoginPage() {
  // useSearchParams must be inside a Suspense boundary for static optimization.
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md px-6 py-24 text-slate-500">Loading…</main>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-center md:text-left">
        {children}
      </div>
    </main>
  );
}

function humanError(code: string): string {
  switch (code) {
    case 'callback_failed':
      return "The magic link couldn't be verified. It may have expired — please request a new one.";
    case 'auth_failed':
      return 'Sign-in failed. Please try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
