// Step 0 — call OpenAI to turn a brief business description into a PrefilledBot.
// No external SDK: plain fetch() against the Chat Completions endpoint with
// strict JSON-schema structured outputs.

import { prefillSchema } from './schema.ts';
import { systemPrompt } from './prompt.ts';
import type {
  PrefilledBot,
  PrefillOptions,
  PrefillRequest,
  PrefillResult,
} from './types.ts';

// User preference: gpt-5.5 (memory: user_llm_preference, 2026-05-19).
// If OpenAI's API exposes this under a slightly different identifier, override
// via the `model` option or by setting OPENAI_MODEL in the env.
const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export async function prefill(
  req: PrefillRequest,
  opts: PrefillOptions,
): Promise<PrefillResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const baseURL = opts.baseURL ?? DEFAULT_BASE_URL;

  const userContent = buildUserContent(req);

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'PrefilledBot',
          strict: true,
          schema: prefillSchema,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response contained no content');
  }

  const bot = JSON.parse(content) as PrefilledBot;

  return { bot, model, usage: data.usage };
}

function buildUserContent(req: PrefillRequest): string {
  const lines: string[] = [];
  lines.push('Generate the wizard configuration for the following business.');
  lines.push('');
  lines.push('Description:');
  lines.push(req.description);
  if (req.industry) {
    lines.push('');
    lines.push(`Industry: ${req.industry}`);
  }
  if (req.website_url) {
    lines.push(`Website: ${req.website_url}`);
  }
  return lines.join('\n');
}
