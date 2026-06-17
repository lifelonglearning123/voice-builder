// Thin client-side wrapper around posthog-js. Every public function no-ops
// when:
//   - Called server-side (typeof window === 'undefined')
//   - NEXT_PUBLIC_POSTHOG_KEY is not configured
//   - PostHog hasn't finished init (silent ignore — events landing during a
//     few-hundred-ms init window aren't worth complicating the call sites for)
//
// Import only from client components ('use client'). posthog-js touches
// window inside init; importing it from a server component is safe at the
// module level but you should never call these functions there.

import posthog from 'posthog-js';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

/** True iff PostHog has a configured key and we're in a browser. */
function enabled(): boolean {
  return typeof window !== 'undefined' && Boolean(KEY);
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (!enabled()) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Never let analytics throw into the app.
  }
}

export function identify(userId: string, properties?: Record<string, unknown>): void {
  if (!enabled()) return;
  try {
    posthog.identify(userId, properties);
  } catch {
    /* silent */
  }
}

export function resetIdentity(): void {
  if (!enabled()) return;
  try {
    posthog.reset();
  } catch {
    /* silent */
  }
}
