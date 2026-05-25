import { NextResponse } from 'next/server';
import { access } from 'node:fs/promises';
import path from 'node:path';

// GET /api/voice-preview?voice_id=...
//
// Returns audio/mpeg for the requested voice.
//
// Routing (in order):
//   1. /public/voice-samples/<voice_id>.mp3 exists → redirect to it (zero latency).
//   2. In-memory cache hit → serve the cached buffer (no upstream call).
//   3. Synthesise with ElevenLabs, buffer the full MP3, cache it, return it.
//
// The cache lives for the lifetime of the server process. First click on each
// voice still pays the ElevenLabs round-trip; every click after that is instant.
// In production (Vercel) the cache survives within a warm lambda instance.
//
// Env:
//   ELEVENLABS_API_KEY — required to synthesise voices without a static sample
//   ELEVENLABS_MODEL_ID — override the default TTS model

export const runtime = 'nodejs';

const SAMPLE_LINE =
  "Hi, this is a sample of my voice. I can answer questions, take messages, and handle bookings — just say what you need.";

// Flash is ~75ms-to-first-byte vs ~400ms for turbo; quality is fine for previews.
const DEFAULT_MODEL = 'eleven_flash_v2_5';

const ttsCache = new Map<string, ArrayBuffer>();

async function staticSampleExists(voiceId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]+$/.test(voiceId)) return false;
  const filePath = path.join(process.cwd(), 'public', 'voice-samples', `${voiceId}.mp3`);
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function audioResponse(buf: ArrayBuffer, source: 'live' | 'cache'): Response {
  return new Response(buf, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Cache': source === 'cache' ? 'HIT' : 'MISS',
    },
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const voiceId = searchParams.get('voice_id');

  if (!voiceId) {
    return NextResponse.json({ error: 'voice_id required' }, { status: 400 });
  }

  if (await staticSampleExists(voiceId)) {
    return NextResponse.redirect(
      new URL(`/voice-samples/${encodeURIComponent(voiceId)}.mp3`, req.url),
      302,
    );
  }

  const cached = ttsCache.get(voiceId);
  if (cached) {
    return audioResponse(cached, 'cache');
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'ELEVENLABS_API_KEY not set on the server. Either set it in .env.local or drop a /public/voice-samples/<voice_id>.mp3 file.',
      },
      { status: 500 },
    );
  }

  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: SAMPLE_LINE,
        model_id: modelId,
      }),
    },
  );

  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => '');
    return NextResponse.json(
      {
        error: `ElevenLabs returned ${upstream.status}`,
        detail: errBody.slice(0, 500),
      },
      { status: upstream.status },
    );
  }

  const buf = await upstream.arrayBuffer();
  ttsCache.set(voiceId, buf);

  return audioResponse(buf, 'live');
}
