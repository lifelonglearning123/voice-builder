import { NextResponse } from 'next/server';

// POST /api/twilio/buy
// Body: { phone_number: "+441234567890", friendly_name?: string }
//
// Purchases the given Twilio number into the configured sub-account.
// Auth: HTTP basic with TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN.

export const runtime = 'nodejs';

interface BuyBody {
  phone_number?: string;
  friendly_name?: string;
  // Optional ISO country code (GB / US / CA). When present, the proxy looks
  // up a regulatory Address SID (and optional Bundle SID) from env vars and
  // attaches them to the purchase request — required in countries like GB.
  country?: string;
}

function basicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

export async function POST(req: Request) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env.local.' },
      { status: 500 },
    );
  }

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

  // Idempotency — if the number is already in this Twilio account (e.g.
  // the user pasted a number they own, or a previous activation already
  // purchased it), skip the purchase and return success.
  const lookupUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`;
  const lookupRes = await fetch(lookupUrl, {
    headers: { Authorization: basicAuth(sid, token) },
  });
  if (lookupRes.ok) {
    const lookupData = (await lookupRes.json().catch(() => ({}))) as {
      incoming_phone_numbers?: Array<{ sid: string; phone_number: string; friendly_name?: string }>;
    };
    const existing = lookupData.incoming_phone_numbers?.find(
      (n) => n.phone_number === phone,
    );
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

  // Attach per-country regulatory IDs when configured. Numbers in some
  // countries (GB, AU, FR, DE, …) require a verified Address on file before
  // purchase, and some number types additionally require a Regulatory Bundle.
  // We resolve the country from the body or from the E.164 prefix.
  const country = resolveCountry(body.country, phone);
  if (country) {
    const addressSid = process.env[`TWILIO_DEFAULT_ADDRESS_SID_${country}`];
    const bundleSid = process.env[`TWILIO_DEFAULT_BUNDLE_SID_${country}`];
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
    const upstreamMessage =
      typeof data.message === 'string' ? data.message : '';
    const code = typeof data.code === 'number' ? data.code : undefined;

    // Map common upstream failures to plain-English messages that don't leak
    // the provider name.
    let error = 'Couldn’t purchase the number. Please try a different one.';
    if (/AddressSid/i.test(upstreamMessage) || code === 21452) {
      error =
        'This country requires a verified business address on file before a number can be purchased. Please contact support to complete the one-time address setup.';
    } else if (/BundleSid/i.test(upstreamMessage) || code === 21408) {
      error =
        'This number requires a regulatory bundle before it can be purchased. Please contact support to complete the one-time setup.';
    } else if (upstream.status === 401 || upstream.status === 403) {
      error = 'Number purchasing is misconfigured. Please contact support.';
    } else if (upstream.status === 404) {
      error = 'That number is no longer available — please pick another.';
    }

    return NextResponse.json(
      {
        error,
        detail: upstreamMessage.slice(0, 500),
        code,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    sid: data.sid,
    phone_number: data.phone_number,
    friendly_name: data.friendly_name,
  });
}

// Resolve the ISO-3166 country code for env-var lookup. Prefers the explicit
// country sent by the frontend; falls back to inferring from the E.164 prefix.
// (Note: +1 covers both US and CA — when no country is provided the env var
// has to be set under TWILIO_DEFAULT_ADDRESS_SID_US, or the frontend must
// pass the country explicitly.)
function resolveCountry(country: string | undefined, phone: string): string | null {
  const explicit = country?.toUpperCase().trim();
  if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit;
  if (phone.startsWith('+44')) return 'GB';
  if (phone.startsWith('+1')) return 'US';
  return null;
}
