import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import {
  sendWelcomeEmail,
  sendAgencyClientWentLiveEmail,
} from '@/lib/email/notifications';

// POST /api/bots/notify-welcome
// Body: { bot_id: string }
//
// Called by Step 08 right after a successful activation. Two side-effects:
//
//   1. Sends the branded "your AI receptionist is live" email to the SMB
//      owner using the current bot state (so the "Test it now: call +44…"
//      line only appears if the phone is actually connected).
//
//   2. Notifies agency owners + admins that this client just went live so
//      they can hand them over to Voice Monitor. Gated on
//      vb.bots.voice_monitor_handoff_notified_at so a retry on the client
//      doesn't send a second agency email. Updates the timestamp once any
//      agency recipient succeeds.
//
// We deliberately don't trigger the welcome from the Stripe webhook —
// payment lands before the deploy + link completes, and the email would
// arrive before the bot is actually live. Triggering from the client after
// markActivated() gives us the right ordering.

export const runtime = 'nodejs';

interface NotifyBody {
  bot_id?: string;
}

export async function POST(request: Request) {
  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const botId = body.bot_id?.trim();
  if (!botId) {
    return NextResponse.json({ error: 'bot_id is required' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  const { data: bot } = await service
    .from('bots')
    .select(
      'agency_id, owner_user_id, phone_e164, draft, status, voice_monitor_handoff_notified_at',
    )
    .eq('id', botId)
    .single();
  if (!bot) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  }
  if (bot.owner_user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
  }
  // Defensive: don't send a "live" email for a bot that isn't live.
  if (bot.status !== 'live') {
    return NextResponse.json(
      { ok: true, sent: false, reason: 'not_live' },
      { status: 200 },
    );
  }

  const { data: agency } = await service
    .from('agencies')
    .select('from_email, from_name, brand_color, ghl_location_id, ghl_api_token')
    .eq('id', bot.agency_id)
    .single();
  if (!agency?.from_email || !agency?.from_name) {
    console.warn('[notify-welcome] agency email not configured');
    return NextResponse.json(
      { ok: true, sent: false, reason: 'agency_email_missing' },
      { status: 200 },
    );
  }

  const draft = (bot.draft as { business_name?: string } | null) ?? null;
  const businessName = draft?.business_name || 'Your AI receptionist';
  const agencyBrand = {
    from_email: agency.from_email,
    from_name: agency.from_name,
    brand_color: agency.brand_color ?? null,
    ghl_location_id: agency.ghl_location_id ?? null,
    ghl_api_token: agency.ghl_api_token ?? null,
  };

  // 1. Client welcome email -------------------------------------------------
  try {
    await sendWelcomeEmail({
      to: user.email ?? '',
      agency: agencyBrand,
      businessName,
      phoneE164: bot.phone_e164 ?? null,
    });
  } catch (e) {
    console.error('[notify-welcome] client welcome send failed:', e);
    // Don't bail — still try the agency notification below.
  }

  // 2. Agency notification email --------------------------------------------
  // Gated on the bot's notified-at timestamp so client retries don't fan
  // out duplicate emails. The first run wins and stamps the row.
  let agencyNotified = false;
  if (!bot.voice_monitor_handoff_notified_at) {
    try {
      const { origin } = new URL(request.url);
      const dashboardUrl = `${origin}/dashboard`;

      const { data: staff } = await service
        .from('agency_members')
        .select('user_id, role')
        .eq('agency_id', bot.agency_id)
        .in('role', ['owner', 'admin']);

      const recipients = await collectAgencyRecipientEmails(service, staff ?? []);

      if (recipients.length > 0) {
        const results = await Promise.allSettled(
          recipients.map((to) =>
            sendAgencyClientWentLiveEmail({
              to,
              agency: agencyBrand,
              businessName,
              clientEmail: user.email ?? '',
              phoneE164: bot.phone_e164 ?? null,
              dashboardUrl,
            }),
          ),
        );
        const anySucceeded = results.some((r) => r.status === 'fulfilled');
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
          console.error(
            `[notify-welcome] ${failures.length}/${results.length} agency notifications failed:`,
            failures.map((f) => (f as PromiseRejectedResult).reason),
          );
        }
        if (anySucceeded) {
          await service
            .from('bots')
            .update({ voice_monitor_handoff_notified_at: new Date().toISOString() })
            .eq('id', botId);
          agencyNotified = true;
        }
      } else {
        console.warn('[notify-welcome] no agency owner/admin recipients found', {
          agencyId: bot.agency_id,
        });
      }
    } catch (e) {
      console.error('[notify-welcome] agency notification flow failed:', e);
    }
  }

  return NextResponse.json({ ok: true, sent: true, agency_notified: agencyNotified });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StaffRow {
  user_id: string;
  role: string;
}

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Look up each staff member's email via the service-role admin API.
 *  De-duplicates and filters out missing/empty addresses. */
async function collectAgencyRecipientEmails(
  service: ServiceClient,
  staff: StaffRow[],
): Promise<string[]> {
  const lookups = await Promise.allSettled(
    staff.map((s) => service.auth.admin.getUserById(s.user_id)),
  );
  const emails = new Set<string>();
  for (const r of lookups) {
    if (r.status !== 'fulfilled') continue;
    const email = r.value.data.user?.email?.trim();
    if (email) emails.add(email.toLowerCase());
  }
  return Array.from(emails);
}
