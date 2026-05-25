'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

// /auth/callback — client component
//
// The Supabase project is configured to return session tokens via URL hash
// fragment (implicit flow) rather than a `?code=` query (PKCE). Hash
// fragments are not sent to the server, so this must run client-side.
//
// We handle BOTH flows defensively:
//   - PKCE (`?code=…`): exchange code → session (via supabase.auth)
//   - Implicit (`#access_token=…`): the browser client auto-consumes the
//     hash on construction (detectSessionInUrl defaults to true), so we
//     just need to wait for the session to settle.
//
// After the session is set client-side, we POST to /api/auth/post-signin
// so the server can auto-provision the user as a client of the current
// agency if they're brand new. Then we redirect to ?next= (or /dashboard).

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // React StrictMode runs effects twice in dev — make sure we only fire once.
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();

        // Implicit flow — hash fragment carries access_token + refresh_token.
        // @supabase/ssr's createBrowserClient is hardcoded to PKCE and won't
        // auto-detect implicit hashes, so we parse them ourselves and call
        // setSession explicitly.
        const hash =
          typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
        if (hash) {
          const hp = new URLSearchParams(hash);
          const accessToken = hp.get('access_token');
          const refreshToken = hp.get('refresh_token');
          const hashError = hp.get('error_description') || hp.get('error');
          if (hashError) throw new Error(hashError);
          if (accessToken && refreshToken) {
            const { error: setError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (setError) throw setError;
          }
        }

        // PKCE flow — exchange the code from the query string.
        const code = params.get('code');
        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          throw new Error('No session was established');
        }

        // Strip the hash so it doesn't linger in the URL.
        if (typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          );
        }

        // Ask the server to auto-provision the user as a client of the
        // current agency if they aren't already in the system. We pass the
        // access token explicitly so the server doesn't rely on cookies
        // being committed yet (there's a race with @supabase/ssr's
        // cookie-storage flush after setSession).
        try {
          await fetch('/api/auth/post-signin', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          });
        } catch {
          // Non-fatal — they're still signed in, just not provisioned.
        }

        const next = sanitizeNext(params.get('next'));
        router.replace(next as never);
      } catch (e) {
        console.error('[auth/callback] failed:', e);
        setError(
          e instanceof Error ? e.message : 'The sign-in link could not be verified.',
        );
        setTimeout(() => router.replace('/login?error=callback_failed' as never), 1500);
      }
    })();
    // We don't depend on params/router; effect runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="relative flex h-40 w-40 items-center justify-center">
          <div className="wizard-aurora" />
          <div className="wizard-orb relative z-10" />
        </div>
        {error ? (
          <>
            <p className="mt-6 font-mono-tight text-[11px] tracking-[0.18em] text-red-500">
              SIGN-IN FAILED
            </p>
            <p className="mt-3 text-sm text-slate-600">{error}</p>
            <p className="mt-1 text-xs text-slate-400">Bouncing you back to login…</p>
          </>
        ) : (
          <>
            <p className="mt-6 font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
              SIGNING YOU IN
            </p>
            <p className="mt-3 text-sm text-slate-500">One second…</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={<main className="mx-auto max-w-md px-6 py-24 text-slate-500">Loading…</main>}
    >
      <CallbackInner />
    </Suspense>
  );
}

function sanitizeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}
