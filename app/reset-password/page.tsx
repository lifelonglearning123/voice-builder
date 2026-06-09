'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

type View = { kind: 'loading' } | { kind: 'form' } | { kind: 'submitting' } | { kind: 'done' } | { kind: 'error'; message: string };

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [view, setView] = useState<View>({ kind: 'loading' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // Supabase sends the reset token as a hash fragment (#access_token=...).
    // We need to establish the session before we can update the password.
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
        if (hash) {
          const hp = new URLSearchParams(hash);
          const accessToken = hp.get('access_token');
          const refreshToken = hp.get('refresh_token');
          const hashError = hp.get('error_description') || hp.get('error');
          if (hashError) throw new Error(hashError);
          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            if (error) throw error;
            window.history.replaceState(null, '', window.location.pathname);
          }
        }
        // Also handle PKCE code flow
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Reset link is invalid or has expired.');
        setView({ kind: 'form' });
      } catch (e) {
        setView({ kind: 'error', message: e instanceof Error ? e.message : 'Invalid reset link.' });
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setView({ kind: 'error', message: "Passwords don't match." });
      return;
    }
    if (password.length < 8) {
      setView({ kind: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    setView({ kind: 'submitting' });
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setView({ kind: 'done' });
      setTimeout(() => router.replace('/dashboard' as never), 2000);
    } catch (err) {
      setView({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to update password.' });
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-center md:text-left">
        <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">VOICE BUILDER</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-900">Set new password.</h1>

        {view.kind === 'loading' && (
          <p className="mt-6 text-sm text-slate-500">Verifying reset link…</p>
        )}

        {view.kind === 'done' && (
          <p className="mt-6 text-sm text-slate-600">Password updated. Taking you to your dashboard…</p>
        )}

        {view.kind === 'error' && (
          <>
            <div className="mt-6 rounded-lg border border-red-100 bg-red-50/50 p-3 text-sm text-red-800">
              {view.message}
            </div>
            <button type="button" onClick={() => router.replace('/forgot-password' as never)} className="mt-4 text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline">
              Request a new reset link
            </button>
          </>
        )}

        {(view.kind === 'form' || view.kind === 'submitting') && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <input
              type="password"
              required
              autoFocus
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 characters)"
              className="wizard-focus block w-full rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 transition-colors focus:border-slate-500"
            />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className="wizard-focus block w-full rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 transition-colors focus:border-slate-500"
            />
            <button type="submit" disabled={view.kind === 'submitting' || !password || !confirm} className="wizard-pill w-full justify-center">
              {view.kind === 'submitting' ? 'Saving…' : 'Set password'}
              {view.kind !== 'submitting' && <span aria-hidden="true">→</span>}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
