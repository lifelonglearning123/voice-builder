import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/server';

// POST /api/auth/dev-magic-link
// Body: { email: string }
//
// Dev-only endpoint. Uses the Supabase admin API to generate a one-time
// magic-link URL WITHOUT sending an email — bypasses the 4-emails-per-hour
// cap on Supabase's default SMTP. Paste the returned action_link into a
// fresh incognito browser to authenticate.
//
// HARD-DISABLED in production. Do not deploy this with NODE_ENV=production.

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { origin } = new URL(request.url);
  const redirectTo = `${origin}/auth/callback?next=/dashboard`;

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    email,
    action_link: data.properties?.action_link ?? null,
    hint: 'Paste action_link into a fresh incognito browser to log in as this user.',
  });
}
