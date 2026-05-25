import { NextResponse } from 'next/server';

// GET /api/twilio/search?country=GB&type=local&areaCode=0117&contains=&limit=20
//
// Proxies Twilio's "Available Phone Numbers" search.
// Auth: HTTP basic with TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN.
//
// Returns: { numbers: AvailableNumber[] }

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

function basicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

export async function GET(req: Request) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env.local.' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const country = (searchParams.get('country') || 'GB').toUpperCase();
  const typeParam = (searchParams.get('type') || 'local').toLowerCase() as NumberType;
  const areaCode = searchParams.get('areaCode')?.trim();
  const contains = searchParams.get('contains')?.trim();
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '20', 10) || 20);

  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'country must be a 2-letter ISO code' }, { status: 400 });
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
    // Map common upstream failures to plain-English messages that don't leak
    // the provider name.
    let message = 'Couldn’t search numbers. Please try different search criteria.';
    if (upstream.status === 400) {
      message =
        'Couldn’t process that search. Check your area code — it should be numbers only, with no spaces or country code.';
    } else if (upstream.status === 401 || upstream.status === 403) {
      message = 'Number search is misconfigured. Please contact support.';
    } else if (upstream.status === 429) {
      message = 'Number search is busy right now. Please try again in a moment.';
    }
    return NextResponse.json(
      {
        error: message,
        detail: detail.slice(0, 500),
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as { available_phone_numbers?: AvailableNumber[] };
  return NextResponse.json({ numbers: data.available_phone_numbers ?? [] });
}
