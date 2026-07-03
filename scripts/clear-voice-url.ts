// One-off: clear voice_url / voice_fallback_url / voice_application_sid on
// the Twilio IncomingPhoneNumber for +447862132038 so inbound calls flow
// through the SIP trunk to Retell instead of being hijacked by GHL.
//
// Pulls the agency-scoped Twilio creds out of vb.agencies (per-agency
// override) rather than relying on the platform env vars.

import { createClient } from '@supabase/supabase-js';
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

const PHONE = '+447862132038';
const AGENCY_ID = '2f80d430-6f64-472a-9967-86acdef40ade'; // Artificial Ignorance
const PHONE_NUMBER_SID = 'PN72aabdafe73379c512327fc1ced3e58f';

const vb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'vb' }, auth: { persistSession: false, autoRefreshToken: false } },
);

function basicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

async function main() {
  console.log(`\nClearing voice_url on ${PHONE} (sid ${PHONE_NUMBER_SID})\n`);

  // 1. Pull agency Twilio creds
  const { data: agency, error } = await vb
    .from('agencies')
    .select('name, twilio_account_sid, twilio_auth_token')
    .eq('id', AGENCY_ID)
    .maybeSingle<{ name: string; twilio_account_sid: string | null; twilio_auth_token: string | null }>();

  if (error || !agency) {
    console.error('Could not load agency creds:', error?.message);
    process.exit(1);
  }
  const sid = agency.twilio_account_sid ?? process.env.TWILIO_ACCOUNT_SID!;
  const token = agency.twilio_auth_token ?? process.env.TWILIO_AUTH_TOKEN!;
  console.log(`Agency: ${agency.name}`);
  console.log(`Twilio account: ${sid.slice(0, 8)}…  (source: ${agency.twilio_account_sid ? 'agency override' : 'platform env'})\n`);

  const auth = basicAuth(sid, token);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${PHONE_NUMBER_SID}.json`;

  // 2. Read current state
  console.log('Before:');
  const beforeRes = await fetch(url, { headers: { Authorization: auth } });
  if (!beforeRes.ok) {
    console.error(`  Lookup failed: ${beforeRes.status} ${await beforeRes.text().catch(() => '')}`);
    process.exit(1);
  }
  const before = (await beforeRes.json()) as Record<string, unknown>;
  console.log(`  voice_url:              ${before.voice_url || '— (empty)'}`);
  console.log(`  voice_fallback_url:     ${before.voice_fallback_url || '— (empty)'}`);
  console.log(`  voice_application_sid:  ${before.voice_application_sid || '— (empty)'}`);
  console.log(`  status_callback:        ${before.status_callback || '— (empty)'}`);
  console.log(`  trunk_sid:              ${before.trunk_sid || '—'}`);

  // 3. PATCH — Twilio API uses POST to update IncomingPhoneNumber
  console.log('\nClearing voice_url, voice_fallback_url, voice_application_sid, status_callback…');
  const patchRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'VoiceUrl=&VoiceFallbackUrl=&VoiceApplicationSid=&StatusCallback=',
  });
  if (!patchRes.ok) {
    console.error(`  Update failed: ${patchRes.status} ${await patchRes.text().catch(() => '')}`);
    process.exit(1);
  }
  const after = (await patchRes.json()) as Record<string, unknown>;
  console.log('\nAfter:');
  console.log(`  voice_url:              ${after.voice_url || '— (empty) ✓'}`);
  console.log(`  voice_fallback_url:     ${after.voice_fallback_url || '— (empty) ✓'}`);
  console.log(`  voice_application_sid:  ${after.voice_application_sid || '— (empty) ✓'}`);
  console.log(`  status_callback:        ${after.status_callback || '— (empty) ✓'}`);
  console.log(`  trunk_sid:              ${after.trunk_sid || '—'}`);

  console.log('\n✓ Done. Try calling the number now — it should route via the trunk to Retell.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
