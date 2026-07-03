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
  const resolved = await resolveUser(request);
  if (!resolved) {
    console.warn('[post-signin] no user found from token or cookie');
    return NextResponse.json({ ok: true, provisioned: false, reason: 'no_user' });
  }
  const { id: userId, email, fullName, phone } = resolved;

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

    // Pre-designated owner? Provision (or upgrade an earlier auto-provisioned
    // client membership) straight to role 'owner'. This runs BEFORE the
    // existing-member short-circuit so an owner who signed up before
    // owner_email was set still gets promoted on their next sign-in. Safe:
    // magic-link sign-in proved control of the email, and owner_email is only
    // ever set by the operator. Any stale agency_clients row is left in place
    // — staff membership takes precedence in the dashboard.
    const ownerEmail = agency.owner_email?.trim().toLowerCase();
    if (ownerEmail && email && email.toLowerCase() === ownerEmail) {
      const { error } = await service
        .from('agency_members')
        .upsert(
          { agency_id: agency.id, user_id: userId, role: 'owner' },
          { onConflict: 'agency_id,user_id' },
        );
      if (error) {
        console.error('[post-signin] owner promotion failed:', error);
        return NextResponse.json(
          { ok: false, provisioned: false, reason: 'owner_promotion_failed', detail: error.message },
          { status: 500 },
        );
      }
      console.log('[post-signin] provisioned as owner', {
        user_id: userId,
        agency_id: agency.id,
        agency_slug: agency.slug,
      });
      return NextResponse.json({
        ok: true,
        provisioned: true,
        role: 'owner',
        agency_id: agency.id,
      });
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
      // Backfill name/phone on the existing client row if we have them and
      // the row is missing them — handles users who signed up before the
      // form started capturing those fields.
      if (
        (clientRows?.length ?? 0) > 0 &&
        (fullName || phone)
      ) {
        const patch: { full_name?: string; phone?: string } = {};
        if (fullName) patch.full_name = fullName;
        if (phone) patch.phone = phone;
        await service
          .from('agency_clients')
          .update(patch)
          .eq('agency_id', agency.id)
          .eq('user_id', userId)
          .or('full_name.is.null,phone.is.null');
      }
      return NextResponse.json({ ok: true, provisioned: false, reason: 'existing_member' });
    }

    const insertRow: {
      agency_id: string;
      user_id: string;
      full_name?: string;
      phone?: string;
    } = { agency_id: agency.id, user_id: userId };
    if (fullName) insertRow.full_name = fullName;
    if (phone) insertRow.phone = phone;

    const { error } = await service
      .from('agency_clients')
      .insert(insertRow);
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

interface ResolvedUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
}

async function resolveUser(request: Request): Promise<ResolvedUser | null> {
  // Preferred: explicit bearer token from the client.
  const authHeader = request.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const service = createSupabaseServiceClient();
      const { data, error } = await service.auth.getUser(token);
      if (!error && data?.user) return pickProfile(data.user);
      if (error) console.warn('[post-signin] bearer token rejected:', error.message);
    }
  }

  // Fallback: cookie-based session (relies on @supabase/ssr cookies being
  // flushed by the client first; can race).
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? pickProfile(user) : null;
}

function pickProfile(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): ResolvedUser {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email?.trim() ?? '',
    fullName: typeof meta.full_name === 'string' ? meta.full_name.trim() : '',
    phone: typeof meta.phone === 'string' ? meta.phone.trim() : '',
  };
}
