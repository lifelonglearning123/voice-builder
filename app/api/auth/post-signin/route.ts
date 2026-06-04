import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { resolveAgency } from '@/lib/agency/resolve';

// POST /api/auth/post-signin
//
// Called by the client-side /auth/callback page once the session is set.
// If the user has no membership *for the agency this request belongs to*,
// auto-provision them as an SMB client of that agency. Membership is
// scoped per-agency: the same user can be staff of agency A and a client
// of agency B independently. The agency is resolved from the Host header
// (or DEFAULT_AGENCY_SLUG in local dev).
//
// Session resolution order:
//   1. Authorization: Bearer <access_token>  — preferred. The client sends
//      this immediately after setSession so we don't have to wait for
//      cookies to commit.
//   2. Cookies via createSupabaseServerClient — fallback for any other
//      caller; works once cookies have synced.

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const userId = await resolveUserId(request);
  if (!userId) {
    console.warn('[post-signin] no user found from token or cookie');
    return NextResponse.json({ ok: true, provisioned: false, reason: 'no_user' });
  }

  try {
    const service = createSupabaseServiceClient();

    // Resolve which agency this request belongs to first — membership is
    // scoped per-agency, so we need the agency id before deciding whether
    // to provision.
    const agency = await resolveAgency({
      host: request.headers.get('host'),
      querySlug: null,
    });
    if (!agency) {
      console.warn('[post-signin] no agency resolved', {
        host: request.headers.get('host'),
        default_slug: process.env.DEFAULT_AGENCY_SLUG,
      });
      return NextResponse.json({ ok: true, provisioned: false, reason: 'no_agency' });
    }

    // Already a staff member or client of THIS agency? Don't auto-provision.
    // Memberships in other agencies are irrelevant — the same user can be
    // a client of multiple agencies, with each "account" kept separate.
    const [{ data: staffRows }, { data: clientRows }] = await Promise.all([
      service
        .from('agency_members')
        .select('agency_id')
        .eq('user_id', userId)
        .eq('agency_id', agency.id)
        .limit(1),
      service
        .from('agency_clients')
        .select('agency_id')
        .eq('user_id', userId)
        .eq('agency_id', agency.id)
        .limit(1),
    ]);
    if ((staffRows?.length ?? 0) > 0 || (clientRows?.length ?? 0) > 0) {
      console.log('[post-signin] existing member of this agency; skipping provision', {
        userId,
        agency_slug: agency.slug,
      });
      return NextResponse.json({ ok: true, provisioned: false, reason: 'existing_member' });
    }

    const { error } = await service
      .from('agency_clients')
      .insert({ agency_id: agency.id, user_id: userId });
    if (error) {
      console.error('[post-signin] insert failed:', error);
      return NextResponse.json(
        { ok: false, provisioned: false, reason: 'insert_failed', detail: error.message },
        { status: 500 },
      );
    }

    console.log('[post-signin] provisioned', {
      user_id: userId,
      agency_id: agency.id,
      agency_slug: agency.slug,
    });
    return NextResponse.json({ ok: true, provisioned: true, agency_id: agency.id });
  } catch (e) {
    console.error('[post-signin] failed:', e);
    return NextResponse.json(
      { ok: false, provisioned: false, reason: 'exception' },
      { status: 500 },
    );
  }
}

async function resolveUserId(request: Request): Promise<string | null> {
  // Preferred: explicit bearer token from the client.
  const authHeader = request.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const service = createSupabaseServiceClient();
      const { data, error } = await service.auth.getUser(token);
      if (!error && data?.user) return data.user.id;
      if (error) console.warn('[post-signin] bearer token rejected:', error.message);
    }
  }

  // Fallback: cookie-based session (relies on @supabase/ssr cookies being
  // flushed by the client first; can race).
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
