import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Next.js middleware. Runs on every request matching the matcher below.
//
// Two jobs:
//   1. Refresh the Supabase auth session cookie if it's near expiry, so
//      Server Components downstream can read a fresh user.
//   2. Gate access to protected routes. Unauthenticated requests to
//      /dashboard, /bots, etc. get bounced to /login. Authenticated users
//      hitting /login get bounced to /dashboard.
//
// The cookie-handling pattern below follows the official @supabase/ssr
// middleware recipe — do not "simplify" it; the response object has to be
// re-created after cookies are set or sessions silently break.

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // No Supabase env yet — let the request through; auth is a no-op.
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: do not remove. getUser() reads the cookie and refreshes the
  // session if needed; without it the cookies set above never get flushed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Routes that require an authenticated user.
  const PROTECTED = ['/dashboard', '/bots'];
  const isProtected = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected && !user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    if (pathname !== '/dashboard') {
      redirect.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(redirect);
  }

  // Already signed in — don't show them the login page.
  if (user && pathname === '/login') {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/dashboard';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and webhook endpoints (which must
    // accept signed requests without our auth flow).
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
