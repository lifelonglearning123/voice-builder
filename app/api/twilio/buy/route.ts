import { NextResponse } from 'next/server';
import { resolveTwilioCredentials, resolveTwilioRegulatory, basicAuth } from '@/lib/twilio/resolve';
import { createSupabaseServiceClient } from '@/lib/supabase/server';

// POST /api/twilio/buy
// Body: { phone_number: "+441234567890", friendly_name?: string, agency_id?: string }
//
// Purchases the given Twilio number. Uses per-agency Twilio credentials when
// agency_id is provided, falls back to platform env vars.

export const runtime = 'nodejs';

interface BuyBody {
  phone_number?: string;
  friendly_name?: string;
  country?: string;
  agency_id?: string;
}

export async function POST(req: Request) {
  let body: BuyBody;
  try {
    body = (await req.json()) as BuyBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const phone = body.phone_number?.trim();
  if (!phone || !/^\+\d{8,15}$/.test(phone)) {
    return NextResponse.json(
      { error: 'phone_number must be a valid E.164 string (e.g. +441234567890)' },
      { status: 400 },
    );
  }

  // Resolve agency_id — prefer explicit body param, fall back to bot lookup
  // if the caller passes bot_id instead.
  let agencyId = body.agency_id?.trim() ?? null;

  let sid: string;
  let token: string;
  try {
    if (agencyId) {
      const creds = await resolveTwilioCredentials(agencyId);
      sid = creds.sid;
      token = creds.token;
    } else {
      sid = process.env.TWILIO_ACCOUNT_SID ?? '';
      token = process.env.TWILIO_AUTH_TOKEN ?? '';
    }
    if (!sid || !token) throw new Error('missing');
  } catch {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env.local.' },
      { status: 500 },
    );
  }

  // Idempotency check — if the number is already in this Twilio account, skip.
  const lookupUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`;
  const lookupRes = await fetch(lookupUrl, {
    headers: { Authorization: basicAuth(sid, token) },
  });
  if (lookupRes.ok) {
    const lookupData = (await lookupRes.json().catch(() => ({}))) as {
      incoming_phone_numbers?: Array<{ sid: string; phone_number: string; friendly_name?: string }>;
    };
    const existing = lookupData.incoming_phone_numbers?.find((n) => n.phone_number === phone);
    if (existing) {
      return NextResponse.json({
        sid: existing.sid,
        phone_number: existing.phone_number,
        friendly_name: existing.friendly_name,
        already_owned: true,
      });
    }
  }

  const form = new URLSearchParams();
  form.set('PhoneNumber', phone);
  if (body.friendly_name) form.set('FriendlyName', body.friendly_name);

  const country = resolveCountry(body.country, phone);
  const numberType = country ? classifyNumberType(country, phone) : null;

  if (country) {
    let addressSid: string | null = null;
    let bundleSid: string | null = null;

    if (agencyId) {
      const reg = await resolveTwilioRegulatory(agencyId, country, numberType);
      addressSid = reg.addressSid;
      bundleSid = reg.bundleSid;
    } else {
      addressSid =
        (numberType && process.env[`TWILIO_DEFAULT_ADDRESS_SID_${country}_${numberType}`]) ||
        process.env[`TWILIO_DEFAULT_ADDRESS_SID_${country}`] ||
        null;
      bundleSid =
        (numberType && process.env[`TWILIO_DEFAULT_BUNDLE_SID_${country}_${numberType}`]) ||
        process.env[`TWILIO_DEFAULT_BUNDLE_SID_${country}`] ||
        null;
    }

    console.log('[twilio/buy] regulatory resolved', { phone, country, numberType, addressSid, bundleSid });
    if (addressSid) form.set('AddressSid', addressSid);
    if (bundleSid) form.set('BundleSid', bundleSid);
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(sid, token),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;

  if (!upstream.ok) {
    const upstreamMessage = typeof data.message === 'string' ? data.message : '';
    const code = typeof data.code === 'number' ? data.code : undefined;

    let error = "Couldn't purchase the number. Please try a different one.";
    if (/AddressSid/i.test(upstreamMessage) || code === 21452) {
      error =
        'This country requires a verified business address on file before a number can be purchased. Please contact support to complete the one-time address setup.';
    } else if (code === 21649 || /regulation type/i.test(upstreamMessage)) {
      console.error('[twilio/buy] bundle regulation mismatch', {
        phone, country, numberType, upstreamMessage,
        hint: country && numberType
          ? `Set bundle_sid for ${country} ${numberType} in your Twilio settings.`
          : null,
      });
      error = "This number type isn't available right now. Please pick a different number, or contact support.";
    } else if (/BundleSid/i.test(upstreamMessage) || code === 21408) {
      error = 'This number requires a regulatory bundle before it can be purchased. Please contact support to complete the one-time setup.';
    } else if (upstream.status === 401 || upstream.status === 403) {
      error = 'Number purchasing is misconfigured. Please contact support.';
    } else if (upstream.status === 404) {
      error = 'That number is no longer available — please pick another.';
    }

    return NextResponse.json({ error, detail: upstreamMessage.slice(0, 500), code }, { status: 502 });
  }

  return NextResponse.json({
    sid: data.sid,
    phone_number: data.phone_number,
    friendly_name: data.friendly_name,
  });
}

function resolveCountry(country: string | undefined, phone: string): string | null {
  const explicit = country?.toUpperCase().trim();
  if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit;
  if (phone.startsWith('+44')) return 'GB';
  if (phone.startsWith('+1')) return 'US';
  return null;
}

function classifyNumberType(country: string, phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '');
  if (country === 'GB') {
    if (/^\+447/.test(digits)) return 'MOBILE';
    if (/^\+44(800|808)/.test(digits)) return 'TOLLFREE';
    return 'LOCAL';
  }
  if (country === 'US') {
    if (/^\+1(800|833|844|855|866|877|888)/.test(digits)) return 'TOLLFREE';
    return 'LOCAL';
  }
  return null;
}
