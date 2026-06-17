import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import {
  sendDropOffEmail,
  type DropOffStage,
} from '@/lib/email/notifications';

// GET /api/cron/draft-recovery
//
// Daily cron triggered by Vercel (see vercel.json). Finds drafts that
// have crossed each recovery threshold (24h, 72h, 7d) but haven't been
// emailed for that stage yet, and sends each one its branded
// drop-off-recovery email exactly once.
//
// Authenticated via the CRON_SECRET env var passed as a Bearer token. In
// production Vercel sends this automatically (configured in vercel.json
// or the project's Environment Variables). We allow unauthenticated
// access in dev where CRON_SECRET isn't set, so the endpoint is
// trigger-testable locally.
//
// The query is index-backed (see migration 012's partial indexes) so it
// stays cheap even with thousands of historical drafts.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DraftRow {
  id: string;
  agency_id: string;
  owner_user_id: string | null;
  draft: { business_name?: string } | null;
  created_at: string;
}

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const STAGES: Array<{ stage: DropOffStage; column: string; ageHours: number }> = [
  { stage: '24h', column: 'drop_off_email_24h_sent_at', ageHours: 24 },
  { stage: '72h', column: 'drop_off_email_72h_sent_at', ageHours: 72 },
  { stage: '7d', column: 'drop_off_email_7d_sent_at', ageHours: 24 * 7 },
];

export async function GET(request: Request) {
  // Auth: only enforced when CRON_SECRET is set, so this is safe to hit
  // locally during development without configuration.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const service = createSupabaseServiceClient();
  const { origin } = new URL(request.url);
  const summary: Record<string, { sent: number; skipped: number; failed: number }> = {};

  for (const { stage, column, ageHours } of STAGES) {
    const cutoff = new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
    const { data: drafts, error } = await service
      .from('bots')
      .select('id, agency_id, owner_user_id, draft, created_at')
      .eq('status', 'draft')
      .lt('created_at', cutoff)
      .is(column, null)
      .limit(500);

    if (error) {
      console.error(`[draft-recovery] query failed at stage ${stage}:`, error);
      summary[stage] = { sent: 0, skipped: 0, failed: 1 };
      continue;
    }

    const stageSummary = await sendStage(
      service,
      origin,
      stage,
      column,
      (drafts as DraftRow[]) ?? [],
    );
    summary[stage] = stageSummary;
  }

  return NextResponse.json({ ok: true, summary });
}

async function sendStage(
  service: ServiceClient,
  origin: string,
  stage: DropOffStage,
  column: string,
  drafts: DraftRow[],
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Cache agency lookups by id across drafts in the same run — agencies
  // are stable and we don't want to fan-out one query per draft.
  const agencyCache = new Map<string, AgencyEmailRow | null>();

  for (const draft of drafts) {
    try {
      if (!draft.owner_user_id) {
        // Defensive: a draft without an owner can't be emailed.
        skipped++;
        continue;
      }

      const agency = await getAgencyEmail(service, agencyCache, draft.agency_id);
      if (!agency?.from_email || !agency?.from_name) {
        skipped++;
        continue;
      }

      const { data: userResult } = await service.auth.admin.getUserById(draft.owner_user_id);
      const recipient = userResult.user?.email?.trim();
      if (!recipient) {
        skipped++;
        continue;
      }

      const businessName = draft.draft?.business_name?.trim() || null;
      const resumeUrl = `${origin}/bots/new?bot=${draft.id}`;

      await sendDropOffEmail({
        to: recipient,
        agency: {
          from_email: agency.from_email,
          from_name: agency.from_name,
          brand_color: agency.brand_color ?? null,
          ghl_location_id: agency.ghl_location_id ?? null,
          ghl_api_token: agency.ghl_api_token ?? null,
        },
        stage,
        businessName,
        resumeUrl,
      });

      // Stamp the column AFTER the send succeeds. If the update fails the
      // next run will try again — acceptable; duplicate sends are bounded
      // by the worst case of an immediately-following retry, not a flood.
      await service
        .from('bots')
        .update({ [column]: new Date().toISOString() })
        .eq('id', draft.id);

      sent++;
    } catch (e) {
      console.error(`[draft-recovery] send failed for draft ${draft.id} stage ${stage}:`, e);
      failed++;
    }
  }

  return { sent, skipped, failed };
}

interface AgencyEmailRow {
  from_email: string | null;
  from_name: string | null;
  brand_color: string | null;
  ghl_location_id: string | null;
  ghl_api_token: string | null;
}

async function getAgencyEmail(
  service: ServiceClient,
  cache: Map<string, AgencyEmailRow | null>,
  agencyId: string,
): Promise<AgencyEmailRow | null> {
  if (cache.has(agencyId)) return cache.get(agencyId) ?? null;
  const { data } = await service
    .from('agencies')
    .select('from_email, from_name, brand_color, ghl_location_id, ghl_api_token')
    .eq('id', agencyId)
    .maybeSingle();
  const row = (data as AgencyEmailRow | null) ?? null;
  cache.set(agencyId, row);
  return row;
}
