'use client';

import { useState } from 'react';

// /dev/magic-link
//
// Dev-only page. Generates a magic-link URL via Supabase's admin API and
// shows it for copy/paste — no email sent, no rate limit. Paste the URL
// into a fresh incognito window to log in as the given email.
//
// IMPORTANT: never expose this page in production. The underlying API
// hard-disables itself when NODE_ENV=production but you should also keep
// this file out of the prod build.

type View =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; email: string; url: string }
  | { kind: 'error'; message: string };

export default function DevMagicLinkPage() {
  const [email, setEmail] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setView({ kind: 'loading' });
    setCopied(false);
    try {
      const res = await fetch('/api/auth/dev-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.action_link) {
        setView({ kind: 'error', message: data.error || `HTTP ${res.status}` });
        return;
      }
      setView({ kind: 'ready', email: data.email, url: data.action_link });
    } catch (err) {
      setView({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore — user can still right-click → copy.
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono-tight text-[11px] tracking-[0.18em] text-amber-600">
        DEV ONLY
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-900">
        Generate a magic link
      </h1>
      <p className="mt-3 text-base leading-relaxed text-slate-500">
        Bypasses Supabase&apos;s rate-limited email pipeline. Returns a one-time-use
        URL that you paste into a fresh incognito window to log in as that user.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-3">
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="chao+smbtest@macaws.ai"
          className="block w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={view.kind === 'loading' || !email.trim()}
          className="wizard-pill"
        >
          {view.kind === 'loading' ? 'Generating…' : 'Generate link'}
          <span aria-hidden="true">→</span>
        </button>
      </form>

      {view.kind === 'error' && (
        <div className="mt-6 rounded-lg border border-red-100 bg-red-50/50 p-4 text-sm text-red-800">
          <p className="font-medium">Couldn&apos;t generate a link</p>
          <p className="mt-1 text-xs">{view.message}</p>
        </div>
      )}

      {view.kind === 'ready' && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-medium text-slate-900">
            Magic link for <span className="font-mono">{view.email}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Paste into a fresh incognito browser tab — one-time use.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
            {view.url}
          </pre>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleCopy(view.url)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500"
            >
              {copied ? '✓ Copied' : 'Copy URL'}
            </button>
            <a
              href={view.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline"
            >
              Open in new tab →
            </a>
          </div>
        </div>
      )}

      <p className="mt-10 text-xs text-slate-400">
        This page only works when NODE_ENV ≠ &quot;production&quot;. Once Resend is
        wired up in Supabase, you can stop using it and go back to the normal
        signup flow.
      </p>
    </main>
  );
}
