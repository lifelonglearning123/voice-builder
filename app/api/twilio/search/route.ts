import { NextResponse } from 'next/server';
import { resolveTwilioCredentials, basicAuth } from '@/lib/twilio/resolve';

// GET /api/twilio/search?country=GB&type=local&areaCode=0117&contains=&limit=20&agency_id=<uuid>
//
// Proxies Twilio's "Available Phone Numbers" search.
// Uses per-agency Twilio credentials when agency_id is provided,
// falls back to platform env vars.

export const runtime = 'nodejs';

type NumberType = 'local' | 'tollfree' | 'mobile';

interface AvailableNumber {
  phone_number: string;
  friendly_name: string;
  locality: string | null;
  region: string | null;
  iso_country: string;
  capabilities: {
    voice: boolean;
    SMS: boolean;
    MMS: boolean;
    fax: boolean;
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const agencyId = searchParams.get('agency_id')?.trim();
  const country = (searchParams.get('country') || 'GB').toUpperCase();
  const typeParam = (searchParams.get('type') || 'local').toLowerCase() as NumberType;
  const areaCode = searchParams.get('areaCode')?.trim();
  const contains = searchParams.get('contains')?.trim();
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '20', 10) || 20);

  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'country must be a 2-letter ISO code' }, { status: 400 });
  }

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
    if (!sid || !token) throw new Error('missing credentials');
  } catch {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set.' },
      { status: 500 },
    );
  }

  const typeSegment =
    typeParam === 'tollfree' ? 'TollFree' : typeParam === 'mobile' ? 'Mobile' : 'Local';

  const params = new URLSearchParams();
  params.set('PageSize', String(limit));
  params.set('VoiceEnabled', 'true');
  if (areaCode) params.set('AreaCode', areaCode);
  if (contains) params.set('Contains', contains);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/AvailablePhoneNumbers/${country}/${typeSegment}.json?${params.toString()}`;

  const upstream = await fetch(url, {
    method: 'GET',
    headers: { Authorization: basicAuth(sid, token) },
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    let message = 'Couldn't search numbers. Please try different search criteria.';
    if (upstream.status === 400) {
      message =
        'Couldn't process that search. Check your area code — it should be numbers only, with no spaces or country code.';
    } else if (upstream.status === 401 || upstream.status === 403) {
      message = 'Number search is misconfigured. Please contact support.';
    } else if (upstream.status === 429) {
      message = 'Number search is busy right now. Please try again in a moment.';
    }
    return NextResponse.json({ error: message, detail: detail.slice(0, 500) }, { status: 502 });
  }

  const data = (await upstream.json()) as { available_phone_numbers?: AvailableNumber[] };
  return NextResponse.json({ numbers: data.available_phone_numbers ?? [] });
}
