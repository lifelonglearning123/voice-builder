import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveTwilioCredentials, basicAuth } from '@/lib/twilio/resolve';

// GET /api/agency/twilio/bundles?agency_id=<uuid>
//
// Lists approved regulatory bundles from the agency's Twilio account.
// Falls back to platform credentials if the agency hasn't configured their own.

export const runtime = 'nodejs';

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

  let sid: string;
  let token: string;
  try {
    const creds = await resolveTwilioCredentials(agencyId);
    sid = creds.sid;
    token = creds.token;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const res = await fetch(
    'https://numbers.twilio.com/v2/RegulatoryCompliance/Bundles?PageSize=100&Status=twilio-approved',
    { headers: { Authorization: basicAuth(sid, token) } },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[agency/twilio/bundles] Twilio error:', detail);
    return NextResponse.json({ error: 'Failed to fetch bundles from Twilio.' }, { status: 502 });
  }

  const data = (await res.json()) as {
    results?: Array<{ sid: string; friendly_name: string; status: string }>;
  };

  return NextResponse.json({ bundles: data.results ?? [] });
}
