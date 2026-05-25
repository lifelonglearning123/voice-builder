'use client';

import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client. Used in client components / hooks. Reads
// session from cookies set by the server during auth callback. Never use the
// service_role key here — only the public anon key.
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }
  return createBrowserClient(url, anon, {
    db: { schema: 'vb' },
  });
}
