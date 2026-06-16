import { headers } from 'next/headers';
import { resolveAgency } from '@/lib/agency/resolve';
import SignupForm from './SignupForm';

// /signup
//
// SMB self-serve sign-up. Same magic-link mechanism as /login — the
// difference is server-side: when the user clicks the email link, the auth
// callback auto-provisions them as a client of whichever agency owns the
// host they're on. See `app/auth/callback/route.ts` for that logic.
//
// This server shell resolves the active agency from the Host header so we
// can hand the form a sensible default for the phone-input country
// selector (the agency's stripe_country — Leonardo's GB agency defaults
// to GB, an Australian agency to AU, etc.). The interactive form itself
// lives in SignupForm.tsx as a client component.

export const runtime = 'nodejs';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ agency?: string }>;
}) {
  const params = await searchParams;
  const h = await headers();
  const agency = await resolveAgency({
    host: h.get('host'),
    querySlug: params.agency ?? null,
  });

  // stripe_country is NOT NULL with default 'GB' so this is always set on
  // a resolved row; the fallback only matters when the host doesn't match
  // any agency (preview URLs, misconfigured domains).
  const defaultCountry = agency?.stripe_country ?? 'GB';

  return <SignupForm defaultCountry={defaultCountry} />;
}
