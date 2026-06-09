'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

type View = { kind: 'form' } | { kind: 'submitting' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [view, setView] = useState<View>({ kind: 'form' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setView({ kind: 'submitting' });
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setView({ kind: 'sent', email: email.trim() });
    } catch (err) {
      setView({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to send reset email.' });
    }
  }

  if (view.kind === 'sent') {
    return (
      <main className="min-h-screen">
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-center md:text-left">
          <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">VOICE BUILDER</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-900">Check your email.</h1>
          <p className="mt-3 text-base leading-relaxed text-slate-500">
            We sent a password reset link to <span className="font-medium text-slate-700">{view.email}</span>. It expires in an hour.
          </p>
          <Link href={'/login' as never} className="mt-8 text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline">
            ← Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  const submitting = view.kind === 'submitting';

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-center md:text-left">
        <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">VOICE BUILDER</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-900">Reset password.</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-500">
          Enter your email and we&apos;ll send you a link to set a new password.
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
          <button type="submit" disabled={submitting || !email.trim()} className="wizard-pill w-full justify-center">
            {submitting ? 'Sending…' : 'Send reset link'}
            {!submitting && <span aria-hidden="true">→</span>}
          </button>
        </form>

        <Link href={'/login' as never} className="mt-8 text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </main>
  );
}
