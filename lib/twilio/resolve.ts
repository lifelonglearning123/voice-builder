// Resolves Twilio credentials and regulatory config for an agency.
// DB values take precedence; falls back to platform env vars so existing
// agencies that haven't set per-agency credentials continue to work.

import { createSupabaseServiceClient } from '@/lib/supabase/server';

export interface TwilioCredentials {
  sid: string;
  token: string;
}

export interface RegulatoryIds {
  bundleSid: string | null;
  addressSid: string | null;
}

interface AgencyTwilioRow {
  twilio_account_sid: string | null;
  twilio_auth_token: string | null;
  twilio_regulatory: Record<string, Record<string, { bundle_sid?: string | null; address_sid?: string | null }>> | null;
}

export async function resolveTwilioCredentials(agencyId: string): Promise<TwilioCredentials> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from('agencies')
    .select('twilio_account_sid, twilio_auth_token')
    .eq('id', agencyId)
    .maybeSingle() as { data: AgencyTwilioRow | null };

  const sid = data?.twilio_account_sid?.trim() || process.env.TWILIO_ACCOUNT_SID;
  const token = data?.twilio_auth_token?.trim() || process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error('Twilio credentials are not configured for this agency.');
  }
  return { sid, token };
}

export async function resolveTwilioRegulatory(
  agencyId: string,
  country: string,
  numberType: string | null,
): Promise<RegulatoryIds> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from('agencies')
    .select('twilio_regulatory')
    .eq('id', agencyId)
    .maybeSingle() as { data: AgencyTwilioRow | null };

  const regulatory = data?.twilio_regulatory ?? {};
  const countryConfig = regulatory[country.toUpperCase()] ?? {};
  const typeConfig = numberType ? (countryConfig[numberType.toUpperCase()] ?? {}) : {};

  // DB value takes precedence; fall back to env vars using the same lookup
  // order the buy route used before per-agency config existed.
  const type = numberType?.toUpperCase() ?? null;
  const bundleSid =
    typeConfig.bundle_sid ??
    (type ? process.env[`TWILIO_DEFAULT_BUNDLE_SID_${country}_${type}`] : null) ??
    process.env[`TWILIO_DEFAULT_BUNDLE_SID_${country}`] ??
    null;

  const addressSid =
    typeConfig.address_sid ??
    (type ? process.env[`TWILIO_DEFAULT_ADDRESS_SID_${country}_${type}`] : null) ??
    process.env[`TWILIO_DEFAULT_ADDRESS_SID_${country}`] ??
    null;

  return { bundleSid: bundleSid || null, addressSid: addressSid || null };
}

export function basicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}
