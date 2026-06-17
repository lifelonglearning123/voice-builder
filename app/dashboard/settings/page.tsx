import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BrandingForm } from '@/components/dashboard/BrandingForm';
import { CouponsSection } from '@/components/dashboard/CouponsSection';
import { TwilioConfig } from '@/components/dashboard/TwilioConfig';

// /dashboard/settings — agency staff only.
//
// Right now it surfaces Stripe Connect onboarding state with a button to
// start (or continue, or re-do) onboarding. Other agency settings (brand
// colour, from_email, custom_domain) come later — for v1 those are managed
// by platform admins (Macaws) via SQL.
//
// SMB clients hitting this URL get bounced to /dashboard.

export const runtime = 'nodejs';

export default async function AgencySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Must be agency staff (owner or admin) to see this page.
  const { data: staffRows } = await supabase
    .from('agency_members')
    .select(
      'role, agencies(id, name, slug, stripe_connect_account_id, stripe_connect_onboarding_complete, stripe_country, brand_logo_url, brand_color, custom_domain, custom_domain_verified, client_price_pence, client_currency)',
    )
    .eq('user_id', user.id);

  type StaffJoin = {
    role: 'owner' | 'admin' | 'staff';
    agencies: {
      id: string;
      name: string;
      slug: string;
      stripe_connect_account_id: string | null;
      stripe_connect_onboarding_complete: boolean;
      stripe_country: string | null;
      brand_logo_url: string | null;
      brand_color: string | null;
      custom_domain: string | null;
      custom_domain_verified: boolean;
      client_price_pence: number | null;
      client_currency: string | null;
    } | null;
  };

  const staffOf = ((staffRows as StaffJoin[] | null) ?? []).filter(
    (r): r is StaffJoin & { agencies: NonNullable<StaffJoin['agencies']> } => !!r.agencies,
  );

  if (staffOf.length === 0) {
    redirect('/dashboard');
  }

  // For v1, pick the first agency. Multi-agency users get a selector later.
  const { agencies: agency, role } = staffOf[0];
  const canManage = role === 'owner' || role === 'admin';

  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
              VOICE BUILDER
            </p>
            <Link
              href={'/dashboard' as never}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Dashboard
            </Link>
            <span className="text-xs font-semibold text-slate-900">Settings</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">{user.email}</span>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
          AGENCY SETTINGS · {role.toUpperCase()}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] text-slate-900">
          {agency.name}
        </h1>

        {params.stripe === 'complete' && (
          <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            ✓ Stripe onboarding complete. You can now accept payments from your clients.
          </div>
        )}
        {params.stripe === 'incomplete' && (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Stripe onboarding wasn&apos;t finished. Pick up where you left off below.
          </div>
        )}
        {params.error && (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Something went wrong: {params.error}. Please try again.
          </div>
        )}

        <ConnectCard
          agencyId={agency.id}
          accountId={agency.stripe_connect_account_id}
          onboardingComplete={agency.stripe_connect_onboarding_complete}
          canManage={canManage}
        />

        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
          <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
            BRANDING
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
            How your marketing site looks
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Your agency name, logo, brand colour, and the price you charge your SMB
            clients. Visitors landing at your custom domain see this branding everywhere
            — homepage, pricing, FAQ, signup, dashboard.
          </p>

          {canManage ? (
            <div className="mt-6">
              <BrandingForm
                agencyId={agency.id}
                initial={{
                  // Agency name is locked at the deployment level — show the
                  // env override that the marketing site actually renders,
                  // falling back to the DB row only when no override is set.
                  // Matches the precedence in lib/agency/marketing.ts.
                  name: process.env.DEFAULT_BRAND_NAME?.trim() || agency.name,
                  brand_logo_url: agency.brand_logo_url,
                  brand_color: agency.brand_color,
                  custom_domain: agency.custom_domain,
                  custom_domain_verified: agency.custom_domain_verified,
                  client_price_pence: agency.client_price_pence,
                  client_currency: agency.client_currency,
                }}
              />
            </div>
          ) : (
            <p className="mt-6 text-xs text-slate-400">
              Only agency owners and admins can update branding.
            </p>
          )}
        </section>

        {canManage && (
          <CouponsSection
            agencyId={agency.id}
            defaultCurrency={agency.client_currency ?? 'GBP'}
          />
        )}

        {canManage && (
          <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
            <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
              TWILIO
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
              Phone number provider
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Connect your own Twilio account so your clients' phone numbers are
              purchased under your account. Leave blank to use the platform account.
              Add your approved regulatory bundles and addresses so numbers can be
              purchased in countries that require compliance documents.
            </p>
            <TwilioConfig agencyId={agency.id} />
          </section>
        )}
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------------------
 * Connect status card
 * ------------------------------------------------------------------------- */

// Subset of Stripe Connect Express supported countries, kept in sync with the
// allowlist in app/api/stripe/connect/start/route.ts. Ordered with the
// most-likely ones first; the rest sorted alphabetically by label.
const COUNTRY_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'IE', label: 'Ireland' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'AT', label: 'Austria' },
  { code: 'BE', label: 'Belgium' },
  { code: 'BG', label: 'Bulgaria' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'CY', label: 'Cyprus' },
  { code: 'CZ', label: 'Czechia' },
  { code: 'DE', label: 'Germany' },
  { code: 'DK', label: 'Denmark' },
  { code: 'EE', label: 'Estonia' },
  { code: 'ES', label: 'Spain' },
  { code: 'FI', label: 'Finland' },
  { code: 'FR', label: 'France' },
  { code: 'GR', label: 'Greece' },
  { code: 'HK', label: 'Hong Kong' },
  { code: 'HR', label: 'Croatia' },
  { code: 'HU', label: 'Hungary' },
  { code: 'IT', label: 'Italy' },
  { code: 'JP', label: 'Japan' },
  { code: 'LT', label: 'Lithuania' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'LV', label: 'Latvia' },
  { code: 'MT', label: 'Malta' },
  { code: 'MX', label: 'Mexico' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'NO', label: 'Norway' },
  { code: 'PL', label: 'Poland' },
  { code: 'PT', label: 'Portugal' },
  { code: 'RO', label: 'Romania' },
  { code: 'SE', label: 'Sweden' },
  { code: 'SG', label: 'Singapore' },
  { code: 'SI', label: 'Slovenia' },
  { code: 'SK', label: 'Slovakia' },
];

function ConnectCard({
  agencyId,
  accountId,
  onboardingComplete,
  canManage,
}: {
  agencyId: string;
  accountId: string | null;
  onboardingComplete: boolean;
  canManage: boolean;
}) {
  const status: 'not_started' | 'incomplete' | 'connected' = !accountId
    ? 'not_started'
    : !onboardingComplete
      ? 'incomplete'
      : 'connected';

  return (
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
      <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
        PAYMENTS
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
        Stripe — accept payments from your clients
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        Connect your Stripe account so SMB clients can subscribe directly. Payments go
        to your bank account on Stripe&apos;s normal payout schedule. The platform
        doesn&apos;t take a cut from these transactions.
      </p>

      <div className="mt-5 flex items-center gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
            status === 'connected'
              ? 'border-green-200 bg-green-50 text-green-800'
              : status === 'incomplete'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'connected'
                ? 'bg-green-500'
                : status === 'incomplete'
                  ? 'bg-amber-500'
                  : 'bg-slate-400'
            }`}
          />
          {status === 'connected' && 'Connected'}
          {status === 'incomplete' && 'Onboarding incomplete'}
          {status === 'not_started' && 'Not connected'}
        </span>
        {accountId && (
          <code className="text-[11px] text-slate-400">{accountId}</code>
        )}
      </div>

      {canManage && (
        <form action="/api/stripe/connect/start" method="post" className="mt-6 space-y-4">
          <input type="hidden" name="agency_id" value={agencyId} />
          {status === 'not_started' && (
            <label className="block max-w-xs">
              <span className="text-xs font-medium tracking-tight text-slate-700">
                Country of your business
              </span>
              <select
                name="stripe_country"
                defaultValue=""
                required
                className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-900/[0.04]"
              >
                <option value="" disabled>
                  — select your country —
                </option>
                {COUNTRY_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11px] leading-snug tracking-tight text-slate-500">
                Where your business is registered and banks. Stripe locks this once
                onboarding starts — pick carefully.
              </span>
            </label>
          )}
          <button type="submit" className="wizard-pill">
            {status === 'connected'
              ? 'Manage Stripe account →'
              : status === 'incomplete'
                ? 'Continue setup →'
                : 'Set up payments →'}
          </button>
        </form>
      )}
      {!canManage && (
        <p className="mt-6 text-xs text-slate-400">
          Only agency owners and admins can manage payment settings.
        </p>
      )}
    </section>
  );
}
