import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { sendWelcomeEmail } from '@/lib/email/notifications';

// POST /api/bots/notify-welcome
// Body: { bot_id: string }
//
// Called by Step 08 right after a successful activation. Sends the branded
// "your AI receptionist is live" email to the SMB owner using the current
// bot state (so the "Test it now: call +44…" line only appears if the
// phone is actually connected).
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
    .select('agency_id, owner_user_id, phone_e164, draft, status')
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

  try {
    await sendWelcomeEmail({
      to: user.email ?? '',
      agency: {
        from_email: agency.from_email,
        from_name: agency.from_name,
        brand_color: agency.brand_color ?? null,
        ghl_location_id: agency.ghl_location_id ?? null,
        ghl_api_token: agency.ghl_api_token ?? null,
      },
      businessName: draft?.business_name || 'Your AI receptionist',
      phoneE164: bot.phone_e164 ?? null,
    });
    return NextResponse.json({ ok: true, sent: true });
  } catch (e) {
    console.error('[notify-welcome] send failed:', e);
    return NextResponse.json(
      { ok: true, sent: false, reason: 'send_failed' },
      { status: 200 },
    );
  }
}
