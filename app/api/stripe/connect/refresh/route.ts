import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// GET /api/stripe/connect/refresh?agency_id=<uuid>
//
// Stripe redirects here when an onboarding link expires (~5 min validity).
// We generate a fresh one and bounce the user back to Stripe so they can
// continue. No auth check needed — links are tied to a specific Stripe
// account and Stripe enforces session continuity on their side.

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
    .select('stripe_connect_account_id')
    .eq('id', agencyId)
    .single();
  if (!agency?.stripe_connect_account_id) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=no_account`);
  }

  try {
    const stripe = getStripe();
    const link = await stripe.accountLinks.create({
      account: agency.stripe_connect_account_id,
      refresh_url: `${origin}/api/stripe/connect/refresh?agency_id=${agencyId}`,
      return_url: `${origin}/api/stripe/connect/return?agency_id=${agencyId}`,
      type: 'account_onboarding',
    });
    return NextResponse.redirect(link.url, { status: 303 });
  } catch (e) {
    console.error('[connect/refresh] failed:', e);
    return NextResponse.redirect(`${origin}/dashboard/settings?error=refresh_failed`);
  }
}
