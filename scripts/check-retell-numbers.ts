// Quick one-off to check whether a list of phone numbers is registered in
// Retell, and if so what agent they're bound to. Useful for triangulating
// state when Twilio says the number doesn't exist.

import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (!/^["']/.test(val)) {
        const hash = val.indexOf(' #');
        if (hash !== -1) val = val.slice(0, hash).trim();
      }
      val = val.replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
loadEnv();

const PHONES = process.argv.slice(2);
if (PHONES.length === 0) {
  console.error('Usage: check-retell-numbers.ts +44... +44...');
  process.exit(1);
}

const RETELL_BASE = process.env.RETELL_API_BASE || 'https://api.retellai.com';
const key = process.env.RETELL_API_KEY!;

async function main() {
  for (const phone of PHONES) {
    const r = await fetch(`${RETELL_BASE}/get-phone-number/${encodeURIComponent(phone)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 404) {
      console.log(`${phone}  → NOT in Retell`);
      continue;
    }
    if (!r.ok) {
      console.log(`${phone}  → Retell error ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      continue;
    }
    const data = (await r.json()) as {
      phone_number: string;
      inbound_agent_id?: string | null;
      inbound_agents?: Array<{ agent_id: string }>;
      termination_uri?: string;
      nickname?: string;
      last_modification_timestamp?: number;
    };
    const agent = data.inbound_agent_id ?? data.inbound_agents?.[0]?.agent_id ?? '—';
    const modAt = data.last_modification_timestamp
      ? new Date(data.last_modification_timestamp).toISOString()
      : '—';
    console.log(
      `${phone}  → in Retell, agent=${agent}, termination_uri=${data.termination_uri || '—'}, nickname=${data.nickname || '—'}, modified=${modAt}`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
