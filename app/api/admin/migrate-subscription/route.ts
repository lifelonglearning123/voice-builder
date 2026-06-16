import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// POST /api/admin/migrate-subscription
// Body: { bot_id: string, target_agency_id: string }
//
// One-off admin utility for fixing the "customer signed up on the wrong
// domain" case: a bot was provisioned under agency A (e.g. the platform /
// Macaws) but really belongs under agency B (e.g. Leonardo). The customer
// has already paid, the Stripe subscription is live, and the money is going
// to A's Stripe.
//
// This route re-routes that subscription to B's Connect account on the
// next invoice charge, AND moves the bot row + membership so B sees the
// customer in their dashboard going forward.
//
// Stripe semantics: updating `transfer_data.destination` and `on_behalf_of`
// on an active subscription takes effect for the *next* invoice. The
// current invoice (already paid into A) stays where it is — that money has
// to be reconciled out-of-band (refund + recharge, or manual transfer in
// the Stripe dashboard).
//
// Auth: caller must be owner/admin of the bot's CURRENT agency. Rationale:
// we're moving money away from that agency's Stripe, so only that agency's
// own staff can authorize the move. The destination agency cannot pull a
// subscription to itself.

export const runtime = 'nodejs';

interface Body {
  bot_id?: string;
  target_agency_id?: string;
  /** When true, also delete the owner's agency_clients row in the source
   *  agency so they only appear in the destination going forward. Default
   *  false — safer to leave both memberships in place and clean up by hand
   *  once you've verified the migration worked. */
  remove_source_membership?: boolean;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const botId = body.bot_id?.trim();
  const targetAgencyId = body.target_agency_id?.trim();
  if (!botId || !targetAgencyId) {
    return NextResponse.json(
      { error: 'bot_id and target_agency_id are required' },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const service = createSupabaseServiceClient();

  // Load the bot + its current agency.
  const { data: bot, error: botError } = await service
    .from('bots')
    .select(
      'id, agency_id, owner_user_id, client_stripe_subscription_id, client_subscription_status',
    )
    .eq('id', botId)
    .single();
  if (botError || !bot) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  }
  if (!bot.client_stripe_subscription_id) {
    return NextResponse.json(
      { error: 'Bot has no Stripe subscription to migrate.' },
      { status: 400 },
    );
  }
  if (bot.agency_id === targetAgencyId) {
    return NextResponse.json(
      { error: 'Bot is already in the target agency.' },
      { status: 400 },
    );
  }

  // Authorization: caller must be owner/admin of the bot's current agency.
  // (The agency whose Stripe is currently being charged.)
  const { data: membership } = await service
    .from('agency_members')
    .select('role')
    .eq('agency_id', bot.agency_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (
    !membership ||
    (membership.role !== 'owner' && membership.role !== 'admin')
  ) {
    return NextResponse.json(
      {
        error:
          'You must be owner or admin of the source agency (the one currently being charged) to migrate this subscription.',
      },
      { status: 403 },
    );
  }

  // Load the target agency and confirm it has working Connect.
  const { data: targetAgency, error: targetError } = await service
    .from('agencies')
    .select(
      'id, name, slug, stripe_connect_account_id, stripe_connect_onboarding_complete',
    )
    .eq('id', targetAgencyId)
    .single();
  if (targetError || !targetAgency) {
    return NextResponse.json({ error: 'Target agency not found' }, { status: 404 });
  }
  if (
    !targetAgency.stripe_connect_account_id ||
    !targetAgency.stripe_connect_onboarding_complete
  ) {
    return NextResponse.json(
      {
        error:
          'Target agency has not completed Stripe Connect onboarding. They must finish onboarding before subscriptions can be routed to them.',
      },
      { status: 400 },
    );
  }

  // 1. Re-route the live subscription. Takes effect on next invoice.
  const stripe = getStripe();
  try {
    await stripe.subscriptions.update(bot.client_stripe_subscription_id, {
      transfer_data: { destination: targetAgency.stripe_connect_account_id },
      on_behalf_of: targetAgency.stripe_connect_account_id,
      application_fee_percent: 0,
    });
  } catch (e) {
    console.error('[migrate-subscription] Stripe update failed:', e);
    const message = e instanceof Error ? e.message : 'Stripe update failed';
    return NextResponse.json(
      { error: `Stripe update failed: ${message}` },
      { status: 502 },
    );
  }

  // 2. Move the bot row to the target agency so the destination sees it
  //    in their portfolio and the customer's dashboard resolves correctly
  //    when they sign in on the destination's domain.
  const { error: botUpdateError } = await service
    .from('bots')
    .update({ agency_id: targetAgencyId })
    .eq('id', botId);
  if (botUpdateError) {
    console.error('[migrate-subscription] bot reassign failed:', botUpdateError);
    return NextResponse.json(
      {
        error:
          'Stripe routing updated, but bot reassignment to target agency failed. Reconcile manually.',
        detail: botUpdateError.message,
      },
      { status: 500 },
    );
  }

  // 3. Ensure the owner is a client of the target agency. ON CONFLICT
  //    DO NOTHING semantics via upsert with ignoreDuplicates.
  if (bot.owner_user_id) {
    const { error: clientError } = await service
      .from('agency_clients')
      .upsert(
        { agency_id: targetAgencyId, user_id: bot.owner_user_id },
        { onConflict: 'agency_id,user_id', ignoreDuplicates: true },
      );
    if (clientError) {
      console.warn(
        '[migrate-subscription] agency_clients upsert failed (non-fatal):',
        clientError.message,
      );
    }

    // 4. Optionally remove the source membership. Off by default — see
    //    the body type comment for the rationale.
    if (body.remove_source_membership) {
      const { error: deleteError } = await service
        .from('agency_clients')
        .delete()
        .eq('agency_id', bot.agency_id)
        .eq('user_id', bot.owner_user_id);
      if (deleteError) {
        console.warn(
          '[migrate-subscription] source membership delete failed (non-fatal):',
          deleteError.message,
        );
      }
    }
  }

  console.log('[migrate-subscription] migrated', {
    bot_id: botId,
    from_agency: bot.agency_id,
    to_agency: targetAgencyId,
    target_connect_account: targetAgency.stripe_connect_account_id,
  });

  return NextResponse.json({
    ok: true,
    bot_id: botId,
    from_agency_id: bot.agency_id,
    to_agency_id: targetAgencyId,
    target_connect_account: targetAgency.stripe_connect_account_id,
    note: 'Stripe routing applies from the next invoice. Already-paid invoices stay with the source agency.',
  });
}
