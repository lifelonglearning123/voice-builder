import { NextResponse } from 'next/server';

// GET /api/retell/voices
//
// Proxies Retell's GET /list-voices. Returns the array of voices the operator's
// Retell account can use as voice_id when creating an agent. Cached for 5 min
// in-memory so the wizard's Step 2 doesn't hammer Retell on every page mount.
//
// Env:
//   RETELL_API_KEY — required
//   RETELL_API_BASE — optional override

export const runtime = 'nodejs';

const DEFAULT_BASE = 'https://api.retellai.com';
const TTL_MS = 5 * 60 * 1000;

interface RetellVoice {
  voice_id: string;
  voice_name?: string;
  provider?: string;
  gender?: string;
  accent?: string;
  age?: string;
  preview_audio_url?: string;
}

let cache: { fetchedAt: number; voices: RetellVoice[] } | null = null;

export async function GET() {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RETELL_API_KEY not set on the server.' },
      { status: 500 },
    );
  }

  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return NextResponse.json({ voices: cache.voices, cached: true });
  }

  const base = process.env.RETELL_API_BASE || DEFAULT_BASE;
  const upstream = await fetch(`${base}/list-voices`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return NextResponse.json(
      {
        error: `Retell list-voices returned ${upstream.status}`,
        detail: detail.slice(0, 500),
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as RetellVoice[] | { voices?: RetellVoice[] };
  const voices = Array.isArray(data) ? data : data.voices ?? [];
  cache = { fetchedAt: now, voices };

  return NextResponse.json({ voices, cached: false });
}
