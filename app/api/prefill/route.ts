import { NextResponse } from 'next/server';
import { prefill } from '@/src/prefill/prefill.ts';
import {
  extractKnowledgeText,
  isSupportedMime,
  resolveMime,
} from '@/src/prefill/extractText.ts';
import type { PrefillRequest } from '@/src/prefill/types.ts';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server is missing OPENAI_API_KEY. Set it in .env.local.' },
      { status: 500 },
    );
  }

  // Accept either JSON (legacy / no file) or multipart/form-data (with an
  // optional 'knowledge_file' field). Branching on Content-Type keeps the API
  // backward-compatible for any caller that doesn't need the upload.
  const contentType = req.headers.get('content-type') ?? '';

  let parsed: Partial<PrefillRequest> & { knowledge_file?: File };
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('knowledge_file');
      parsed = {
        description: stringField(form, 'description'),
        industry: stringField(form, 'industry') || undefined,
        website_url: stringField(form, 'website_url') || undefined,
        knowledge_file: file instanceof File && file.size > 0 ? file : undefined,
      };
    } else {
      parsed = (await req.json()) as Partial<PrefillRequest>;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!parsed.description || typeof parsed.description !== 'string') {
    return NextResponse.json(
      { error: 'description is required' },
      { status: 400 },
    );
  }

  // Extract knowledge text if a file was attached. Reject early on unsupported
  // types or oversized files so the client gets a clear error before we burn
  // OpenAI tokens.
  let knowledgeText: string | undefined;
  if (parsed.knowledge_file) {
    const file = parsed.knowledge_file;
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large — max ${MAX_FILE_BYTES / 1024 / 1024}MB.` },
        { status: 400 },
      );
    }
    const mime = resolveMime(file.type, file.name);
    if (!isSupportedMime(mime)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Upload a PDF, .txt or .md file.' },
        { status: 400 },
      );
    }
    try {
      const buffer = await file.arrayBuffer();
      const extracted = await extractKnowledgeText(buffer, mime);
      if (!extracted.text) {
        return NextResponse.json(
          {
            error:
              'We couldn’t read any text from this file. If it’s a scanned PDF, try a text-based version.',
          },
          { status: 400 },
        );
      }
      knowledgeText = extracted.text;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json(
        { error: `Could not read the uploaded file: ${message}` },
        { status: 400 },
      );
    }
  }

  try {
    const result = await prefill(
      {
        description: parsed.description,
        industry: parsed.industry,
        website_url: parsed.website_url,
        knowledge_text: knowledgeText,
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

function stringField(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
}
