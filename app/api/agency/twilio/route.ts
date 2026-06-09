import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';

// GET  /api/agency/twilio?agency_id=<uuid>
//   Returns Twilio config for the agency (auth token masked).
//
// POST /api/agency/twilio
//   Body: { agency_id, account_sid?, auth_token?, regulatory? }
//   Saves per-agency Twilio credentials and/or regulatory config.

export const runtime = 'nodejs';

interface PostBody {
  agency_id?: string;
  account_sid?: string | null;
  auth_token?: string | null;
  regulatory?: Record<string, Record<string, { bundle_sid?: string | null; address_sid?: string | null }>>;
}

async function authorize(agencyId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Not signed in' };

  const service = createSupabaseServiceClient();
  const { data: membership } = await service
    .from('agency_members')
    .select('role')
    .eq('agency_id', agencyId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agencyId = searchParams.get('agency_id')?.trim();
  if (!agencyId) return NextResponse.json({ error: 'agency_id is required' }, { status: 400 });

  const auth = await authorize(agencyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createSupabaseServiceClient();
  const { data } = await service
    .from('agencies')
    .select('twilio_account_sid, twilio_auth_token, twilio_regulatory')
    .eq('id', agencyId)
    .maybeSingle();

  const accountSid = data?.twilio_account_sid ?? null;
  const rawToken = data?.twilio_auth_token ?? null;

  return NextResponse.json({
    account_sid: accountSid,
    // Mask the token — show only last 4 chars so the UI can confirm it's set
    auth_token_set: !!rawToken,
    auth_token_hint: rawToken ? `••••••••${rawToken.slice(-4)}` : null,
    regulatory: data?.twilio_regulatory ?? {},
  });
}

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const agencyId = body.agency_id?.trim();
  if (!agencyId) return NextResponse.json({ error: 'agency_id is required' }, { status: 400 });

  const auth = await authorize(agencyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const update: Record<string, unknown> = {};
  if ('account_sid' in body) update.twilio_account_sid = body.account_sid?.trim() || null;
  if ('auth_token' in body) update.twilio_auth_token = body.auth_token?.trim() || null;
  if ('regulatory' in body) update.twilio_regulatory = body.regulatory ?? {};

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { error } = await service.from('agencies').update(update).eq('id', agencyId);
  if (error) {
    console.error('[agency/twilio] update failed:', error);
    return NextResponse.json({ error: 'Failed to save settings.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
