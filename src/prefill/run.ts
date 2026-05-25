// CLI driver for Step 0 prefill.
//
// Usage:
//   $env:OPENAI_API_KEY="sk-..."; npm run prefill:run -- "I run a dental practice..."
//   $env:OPENAI_API_KEY="sk-..."; npm run prefill:run -- --input 01_mark_butcher
//   $env:OPENAI_API_KEY="sk-..."; npm run prefill:run -- --industry "Mortgage broker" "Description..."
//
// Optional env:
//   OPENAI_MODEL=gpt-5.5   (override the default)
//   OPENAI_BASE_URL=...    (override the API base URL)

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prefill } from './prefill.ts';
import type { PrefillRequest } from './types.ts';

await main();

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let description: string | undefined;
  let industry: string | undefined;
  let websiteUrl: string | undefined;
  let inputName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--industry') industry = args[++i];
    else if (a === '--website' || a === '--url') websiteUrl = args[++i];
    else if (a === '--input') inputName = args[++i];
    else if (!description) description = a;
  }

  if (inputName && !description) {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, 'fixtures', `${inputName}.input.md`);
    description = readFileSync(path, 'utf-8').trim();
  }

  if (!description) {
    console.error(
      'Usage:\n' +
        '  prefill:run -- "<description>" [--industry <name>] [--website <url>]\n' +
        '  prefill:run -- --input <fixture_name>',
    );
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Set OPENAI_API_KEY in the environment first.');
    process.exitCode = 1;
    return;
  }

  const req: PrefillRequest = { description };
  if (industry) req.industry = industry;
  if (websiteUrl) req.website_url = websiteUrl;

  const result = await prefill(req, {
    apiKey,
    model: process.env.OPENAI_MODEL,
    baseURL: process.env.OPENAI_BASE_URL,
  });

  console.error(`Model: ${result.model}`);
  if (result.usage) {
    console.error(
      `Tokens: ${result.usage.prompt_tokens} prompt / ${result.usage.completion_tokens} completion / ${result.usage.total_tokens} total`,
    );
  }
  process.stdout.write(JSON.stringify(result.bot, null, 2));
  process.stdout.write('\n');
}
