import { NextResponse } from 'next/server';
import { prefill } from '@/src/prefill/prefill.ts';
import type { PrefillRequest } from '@/src/prefill/types.ts';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server is missing OPENAI_API_KEY. Set it in .env.local.' },
      { status: 500 },
    );
  }

  let body: Partial<PrefillRequest>;
  try {
    body = (await req.json()) as Partial<PrefillRequest>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.description || typeof body.description !== 'string') {
    return NextResponse.json(
      { error: 'description is required' },
      { status: 400 },
    );
  }

  try {
    const result = await prefill(
      {
        description: body.description,
        industry: body.industry,
        website_url: body.website_url,
      },
      {
        apiKey,
        model: process.env.OPENAI_MODEL,
        baseURL: process.env.OPENAI_BASE_URL,
      },
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
