import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Server-side Supabase client. Used in Server Components, Route Handlers, and
// Server Actions. Reads/writes cookies via next/headers so the session
// survives across requests.
//
// IMPORTANT: do NOT pass the service_role key here — this client is per-user
// and should respect RLS. For privileged server-only operations (webhooks
// writing across users, etc.) use createSupabaseServiceClient instead.
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    db: { schema: 'vb' },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies can't be set —
          // ignore. The middleware refreshes the session on the next request.
        }
      },
    },
  });
}

// Service-role client — bypasses RLS. Use ONLY in server routes that need
// to act across users (webhook handlers, admin tasks). Never expose to the
// browser or surface via NEXT_PUBLIC_*.
import { createClient } from '@supabase/supabase-js';

export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
  }
  return createClient(url, serviceKey, {
    db: { schema: 'vb' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
