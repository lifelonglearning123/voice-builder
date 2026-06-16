import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// POST /api/stripe/connect/start
// Body (form-encoded from the settings page): agency_id=<uuid>
//
// Creates a Stripe Connect Express account for the agency if one doesn't
// exist, then generates a fresh onboarding link and redirects the browser
// to Stripe's hosted KYC/bank-details flow. When the user finishes (or
// abandons) they're sent to /api/stripe/connect/return.
//
// Idempotent — calling this multiple times reuses the existing account and
// generates a new onboarding link (Stripe links expire after ~5 min).

export const runtime = 'nodejs';

// Stripe Connect Express supported countries (ISO-3166 alpha-2). Kept as an
// explicit allowlist rather than passing the raw form value through to Stripe
// so a typo or hostile submission can't silently create accounts in unsupported
// regions. Extend as Stripe adds support.
const SUPPORTED_COUNTRIES = new Set([
  'AT', 'AU', 'BE', 'BG', 'CA', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES',
  'FI', 'FR', 'GB', 'GR', 'HK', 'HR', 'HU', 'IE', 'IT', 'JP', 'LT', 'LU',
  'LV', 'MT', 'MX', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'SE', 'SG', 'SI',
  'SK', 'US',
]);

export async function POST(request: Request) {
  const formData = await request.formData();
  const agencyId = (formData.get('agency_id') as string | null)?.trim();
  const requestedCountry = (formData.get('stripe_country') as string | null)
    ?.trim()
    .toUpperCase();
  if (!agencyId) {
    return NextResponse.json({ error: 'agency_id is required' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const { origin } = new URL(request.url);
    return NextResponse.redirect(`${origin}/login`, { status: 303 });
  }

  // Authorization: must be agency owner or admin.
  const service = createSupabaseServiceClient();
  const { data: membership } = await service
    .from('agency_members')
    .select('role')
    .eq('agency_id', agencyId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    const { origin } = new URL(request.url);
    return NextResponse.redirect(
      `${origin}/dashboard/settings?error=not_authorised`,
      { status: 303 },
    );
  }

  const { data: agency } = await service
    .from('agencies')
    .select('id, name, stripe_connect_account_id, stripe_country')
    .eq('id', agencyId)
    .single();
  if (!agency) {
    const { origin } = new URL(request.url);
    return NextResponse.redirect(
      `${origin}/dashboard/settings?error=agency_not_found`,
      { status: 303 },
    );
  }

  const stripe = getStripe();
  const { origin } = new URL(request.url);

  // Country: required only when first creating the account. Once an Express
  // account exists the country is locked by Stripe — we ignore any later
  // submitted value and just reuse the existing account.
  let country = (agency.stripe_country ?? 'GB').toUpperCase();
  if (!agency.stripe_connect_account_id) {
    if (requestedCountry) {
      if (!SUPPORTED_COUNTRIES.has(requestedCountry)) {
        return NextResponse.redirect(
          `${origin}/dashboard/settings?error=unsupported_country`,
          { status: 303 },
        );
      }
      country = requestedCountry;
      if (country !== agency.stripe_country) {
        await service
          .from('agencies')
          .update({ stripe_country: country })
          .eq('id', agency.id);
      }
    }
  }

  try {
    // Create or reuse the Express account.
    let accountId = agency.stripe_connect_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country,
        email: user.email ?? undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: agency.name,
        },
        metadata: { agency_id: agency.id },
      });
      accountId = account.id;
      // First-time Connect setup → default this agency to direct-charge mode.
      // Existing agencies that already had a connect account stay on whatever
      // their use_direct_charges flag was; we never silently flip a live one.
      await service
        .from('agencies')
        .update({
          stripe_connect_account_id: accountId,
          use_direct_charges: true,
        })
        .eq('id', agency.id);
    }

    // Generate a fresh onboarding link.
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/api/stripe/connect/refresh?agency_id=${agency.id}`,
      return_url: `${origin}/api/stripe/connect/return?agency_id=${agency.id}`,
      type: 'account_onboarding',
    });

    return NextResponse.redirect(link.url, { status: 303 });
  } catch (e) {
    console.error('[connect/start] failed:', e);
    return NextResponse.redirect(
      `${origin}/dashboard/settings?error=stripe_setup_failed`,
      { status: 303 },
    );
  }
}
