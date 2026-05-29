import { createSupabaseServiceClient } from '@/lib/supabase/server';

// Resolves which agency owns the current request — used by /signup, the auth
// callback, branded landing pages, etc.
//
// Order of preference:
//   1. Host header match against vb.agencies.custom_domain (production)
//   2. ?agency=<slug> query param (manual override / testing)
//   3. DEFAULT_AGENCY_SLUG env var (local dev, no Host match yet)
//
// Returns the full agency row, or null if nothing matches. The caller decides
// what to do with a null result — typically "fail closed" (don't auto-
// provision, show an error).

export interface AgencyRow {
  id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  brand_logo_url: string | null;
  brand_color: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarding_complete: boolean;
  client_price_pence: number | null;
  client_currency: string | null;
  from_email: string | null;
  from_name: string | null;
  ghl_location_id: string | null;
  ghl_api_token: string | null;
}

export async function resolveAgency(opts: {
  host: string | null;
  querySlug?: string | null;
}): Promise<AgencyRow | null> {
  const service = createSupabaseServiceClient();

  // 1. Custom domain match
  if (opts.host) {
    // Strip port (Host header on dev includes :3000).
    const cleanHost = opts.host.split(':')[0].toLowerCase();
    const { data } = await service
      .from('agencies')
      .select('*')
      .eq('custom_domain', cleanHost)
      .eq('custom_domain_verified', true)
      .maybeSingle();
    if (data) return data as AgencyRow;
  }

  // 2. Query param slug
  if (opts.querySlug) {
    const { data } = await service
      .from('agencies')
      .select('*')
      .eq('slug', opts.querySlug)
      .maybeSingle();
    if (data) return data as AgencyRow;
  }

  // 3. Env fallback for dev
  const defaultSlug = process.env.DEFAULT_AGENCY_SLUG;
  if (defaultSlug) {
    const { data } = await service
      .from('agencies')
      .select('*')
      .eq('slug', defaultSlug)
      .maybeSingle();
    if (data) return data as AgencyRow;
  }

  return null;
}
