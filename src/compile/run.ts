// Quick driver: load a fixture, run compileBot, print the Retell payload.
// Usage: npm run compile:run
//   (= node --experimental-strip-types src/compile/run.ts)

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBot } from './compileBot.ts';
import type { Bot } from './types.ts';

const fixture = process.argv[2] ?? '01_mark_butcher';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, 'fixtures', `${fixture}.bot.json`);

const raw = readFileSync(fixturePath, 'utf-8');
const bot = JSON.parse(raw) as Bot;
const payload = compileBot(bot);

const line = (label: string): string => `\n\n===== ${label} =====\n`;

process.stdout.write(line('general_prompt'));
process.stdout.write(payload.general_prompt);
process.stdout.write(line('begin_message'));
process.stdout.write(payload.begin_message);
process.stdout.write(line('general_tools'));
process.stdout.write(JSON.stringify(payload.general_tools, null, 2));
process.stdout.write(line('post_call_analysis_data'));
process.stdout.write(JSON.stringify(payload.post_call_analysis_data, null, 2));
process.stdout.write(line('meta'));
process.stdout.write(
  JSON.stringify(
    {
      agent_name: payload.agent_name,
      voice_id: payload.voice_id,
      language: payload.language,
      max_call_duration_ms: payload.max_call_duration_ms,
      end_call_after_silence_ms: payload.end_call_after_silence_ms,
    },
    null,
    2,
  ),
);
process.stdout.write('\n');
