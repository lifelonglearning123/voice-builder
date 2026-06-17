'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { identify, resetIdentity } from '@/lib/analytics/track';

// Boots PostHog once on the client and keeps the identified user in sync
// with Supabase auth. Everything no-ops when NEXT_PUBLIC_POSTHOG_KEY is
// unset, so dev/preview deployments without the key behave normally and
// don't pollute the production project.

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // 1. Init PostHog exactly once on mount.
  useEffect(() => {
    if (!KEY || typeof window === 'undefined') return;
    // posthog-js maintains a global so a re-init is harmless, but we guard
    // anyway so Strict Mode's double-effect doesn't double-capture.
    if ((posthog as unknown as { __loaded?: boolean }).__loaded) return;
    posthog.init(KEY, {
      api_host: HOST,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      // Respect Do-Not-Track and reduce noisy autocapture for now —
      // we add explicit events for the wizard funnel below.
      autocapture: false,
      respect_dnt: true,
    });
  }, []);

  // 2. Identify the current Supabase user, and react to sign-in / sign-out.
  useEffect(() => {
    if (!KEY) return;
    const supabase = createSupabaseBrowserClient();

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) identify(user.id, { email: user.email ?? undefined });
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        identify(session.user.id, { email: session.user.email ?? undefined });
      } else if (event === 'SIGNED_OUT') {
        resetIdentity();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}
