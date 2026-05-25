import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// GET /api/stripe/connect/return?agency_id=<uuid>
//
// Stripe redirects here after the agency owner finishes (or exits) the
// Connect Express onboarding flow. We retrieve the account, check whether
// onboarding is actually complete (`details_submitted` AND `charges_enabled`),
// update the DB, and send the user back to the settings page with a flag.

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const agencyId = searchParams.get('agency_id');

  if (!agencyId) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=missing_agency`);
  }

  const service = createSupabaseServiceClient();
  const { data: agency } = await service
    .from('agencies')
    .select('id, stripe_connect_account_id')
    .eq('id', agencyId)
    .single();

  if (!agency?.stripe_connect_account_id) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=no_account`);
  }

  try {
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(agency.stripe_connect_account_id);

    // "Onboarded enough to charge" — `details_submitted` plus `charges_enabled`.
    // `payouts_enabled` may take a bit longer (Stripe verifying bank details);
    // we treat the account as ready when charges work.
    const onboardingComplete =
      !!account.details_submitted && !!account.charges_enabled;

    await service
      .from('agencies')
      .update({ stripe_connect_onboarding_complete: onboardingComplete })
      .eq('id', agencyId);

    return NextResponse.redirect(
      `${origin}/dashboard/settings?stripe=${
        onboardingComplete ? 'complete' : 'incomplete'
      }`,
    );
  } catch (e) {
    console.error('[connect/return] failed:', e);
    return NextResponse.redirect(`${origin}/dashboard/settings?error=verify_failed`);
  }
}
