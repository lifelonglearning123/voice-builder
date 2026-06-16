import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email';

// GET /auth/confirm
//
// Server-side endpoint that finishes Supabase auth flows where the email link
// can't be safely consumed by the browser. Two paths are supported:
//
//   1. PKCE — `?code=<auth_code>`. The browser client persisted the code
//      verifier as a cookie when it called e.g. resetPasswordForEmail. The
//      cookie travels back on this top-level navigation, so the server
//      Supabase client can call exchangeCodeForSession and set the session.
//      Doing the exchange here (instead of client-side on /reset-password)
//      avoids the "PKCE code verifier not found in storage" failure that
//      happens whenever JS can't read the verifier — different browser, the
//      browser blocked third-party-ish cookies, storage was cleared, etc.
//
//   2. OTP token hash — `?token_hash=<hash>&type=<recovery|signup|…>`. Used
//      when the Supabase email template is configured with {{ .TokenHash }}
//      instead of {{ .ConfirmationURL }}. verifyOtp doesn't need a verifier
//      cookie, so it works even when the user opens the link in a different
//      browser than the one that requested it.
//
// On success we 302 to `next` (defaults to /dashboard). On failure we bounce
// back to login with an error in the query string.

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = sanitizeNext(searchParams.get('next'));

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.warn('[auth/confirm] exchangeCodeForSession failed:', error.message);
      return redirectWithError(request, '/login', error.message);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.warn('[auth/confirm] verifyOtp failed:', error.message);
      return redirectWithError(request, '/login', error.message);
    }
  } else {
    return redirectWithError(request, '/login', 'Missing auth code or token.');
  }

  const dest = request.nextUrl.clone();
  dest.pathname = next;
  dest.search = '';
  return NextResponse.redirect(dest);
}

function sanitizeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

function redirectWithError(request: NextRequest, path: string, message: string) {
  const dest = request.nextUrl.clone();
  dest.pathname = path;
  dest.search = `?error=${encodeURIComponent(message)}`;
  return NextResponse.redirect(dest);
}
