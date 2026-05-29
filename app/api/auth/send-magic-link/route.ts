import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveAgency } from '@/lib/agency/resolve';
import { sendEmail } from '@/lib/email/send';
import {
  magicLinkSubject,
  magicLinkHtml,
  magicLinkText,
} from '@/lib/email/templates';

// POST /api/auth/send-magic-link
// Body: { email: string, next?: string, agency?: string }
//
// White-label magic-link delivery. Replaces Supabase Auth's built-in email
// sender (which is project-wide, single From) with per-agency branded
// emails via Resend.
//
// Flow:
//   1. Resolve the active agency from Host header (or ?agency= query param,
//      or DEFAULT_AGENCY_SLUG env in dev).
//   2. Generate a one-time magic-link URL via Supabase admin API (no email
//      sent by Supabase).
//   3. Send the email via Resend with the agency's branded From / subject /
//      body. The user clicks → /auth/callback → existing auto-provision
//      logic kicks in if they're new.

export const runtime = 'nodejs';

interface SendArgs {
  email?: string;
  next?: string;
  agency?: string;
}

export async function POST(request: Request) {
  let body: SendArgs;
  try {
    body = (await request.json()) as SendArgs;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  // Resolve the agency this signup/login belongs to.
  const agency = await resolveAgency({
    host: request.headers.get('host'),
    querySlug: body.agency ?? null,
  });
  if (!agency) {
    return NextResponse.json(
      {
        error:
          'We couldn’t identify which workspace you’re signing in to. Please contact support.',
      },
      { status: 400 },
    );
  }
  if (!agency.from_email || !agency.from_name) {
    return NextResponse.json(
      {
        error:
          'Sign-in email isn’t configured for this workspace yet. Please contact your administrator.',
      },
      { status: 500 },
    );
  }

  // Generate a magic-link URL via admin API — no email sent by Supabase.
  const supabase = createSupabaseServiceClient();
  const { origin } = new URL(request.url);
  const nextPath = sanitizeNext(body.next);
  const callbackQuery = new URLSearchParams();
  callbackQuery.set('next', nextPath);
  if (body.agency) callbackQuery.set('agency', body.agency);
  const redirectTo = `${origin}/auth/callback?${callbackQuery.toString()}`;

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });

  if (error || !data.properties?.action_link) {
    console.error('[send-magic-link] generateLink failed:', error);
    return NextResponse.json(
      { error: 'We couldn’t prepare your sign-in link. Please try again.' },
      { status: 502 },
    );
  }

  // Send via Resend with agency branding.
  try {
    await sendEmail({
      to: email,
      fromEmail: agency.from_email,
      fromName: agency.from_name,
      subject: magicLinkSubject(agency.from_name),
      html: magicLinkHtml({
        url: data.properties.action_link,
        agencyName: agency.from_name,
        brandColor: agency.brand_color,
      }),
      text: magicLinkText({
        url: data.properties.action_link,
        agencyName: agency.from_name,
      }),
      ghl:
        agency.ghl_location_id && agency.ghl_api_token
          ? { locationId: agency.ghl_location_id, apiToken: agency.ghl_api_token }
          : null,
    });
  } catch (e) {
    console.error('[send-magic-link] send failed:', e);
    return NextResponse.json(
      { error: 'We couldn’t send your sign-in email. Please try again.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}

function sanitizeNext(raw: string | undefined): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}
