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
  // Optional — only the signup form sends these. Login does not, because
  // an existing user already has them on record.
  full_name?: string;
  /** E.164 international format (e.g. +447700900123). Validated server-side. */
  phone?: string;
  /** ISO-3166 alpha-2 (e.g. GB, US). Stamped on the GHL contact's country
   *  field for segmentation. Derived from the phone-country dropdown. */
  phone_country?: string;
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

  // Signup-only fields. Trim to empty so we can distinguish "field not
  // present" (login) from "field present but blank" (which the form
  // prevents, but be defensive on the server side).
  const fullName = body.full_name?.trim() ?? '';
  let phone = body.phone?.trim() ?? '';
  let phoneCountry = body.phone_country?.trim().toUpperCase() ?? '';
  // Belt-and-braces: the signup form now sends E.164 (`+44…`). If anything
  // arrives without a leading `+` (older client, direct API hit, etc.) we
  // refuse to forward it to GHL — sending a bare national number would
  // make GHL stamp it with the location's default country code, which is
  // the bug we're fixing. Better to drop the phone than store the wrong
  // international number.
  if (phone && !/^\+[1-9]\d{5,14}$/.test(phone)) {
    console.warn('[send-magic-link] non-E.164 phone rejected:', phone);
    phone = '';
    phoneCountry = '';
  }
  // ISO-3166 alpha-2 sanity check. Drop anything that doesn't fit so GHL
  // doesn't get garbage on the contact's country field.
  if (phoneCountry && !/^[A-Z]{2}$/.test(phoneCountry)) {
    console.warn('[send-magic-link] invalid phone_country rejected:', phoneCountry);
    phoneCountry = '';
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

  // Pass full_name / phone via options.data so Supabase stores them on the
  // user's raw_user_meta_data when the magic link is first verified. The
  // post-signin route then reads them and copies into vb.agency_clients so
  // queries don't have to dig through JSONB.
  //
  // Note: options.data is only persisted on user *creation*. If the user
  // already exists (e.g. retried signup), these fields are silently ignored
  // by Supabase — that's intentional, we don't want a signup form
  // overwriting a previously-collected name.
  const linkOptions: { redirectTo: string; data?: Record<string, string> } = { redirectTo };
  if (fullName || phone) {
    linkOptions.data = {};
    if (fullName) linkOptions.data.full_name = fullName;
    if (phone) linkOptions.data.phone = phone;
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: linkOptions,
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
      // Signup-only — login requests don't send these. The first magic-link
      // hit creates the GHL contact with the user's profile attached; later
      // login emails for the same address upsert by email alone and GHL
      // keeps the previously stored name/phone/country.
      contactName: fullName || undefined,
      contactPhone: phone || undefined,
      contactCountry: phoneCountry || undefined,
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
