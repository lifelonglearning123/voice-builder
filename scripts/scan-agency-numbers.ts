// Usage:
//   node --use-system-ca --experimental-strip-types scripts/scan-agency-numbers.ts <agency-id-or-slug>
//
// Examples:
//   node --use-system-ca --experimental-strip-types scripts/scan-agency-numbers.ts artificial-ignorance
//   node --use-system-ca --experimental-strip-types scripts/scan-agency-numbers.ts 2f80d430-6f64-472a-9967-86acdef40ade
//
// Lists every live bot in the agency, looks up its phone_e164 in Twilio, and
// flags numbers that suffer from the GHL-hijack pattern we saw on the
// Ridgeline Roofing numbers:
//   - trunk_sid missing → no SIP route to Retell at all
//   - voice_url set     → legacy webhook may hijack inbound calls
//
// Read-only. Doesn't change any state.

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

const arg = process.argv[2]?.trim();
if (!arg) {
  console.error('Usage: node --use-system-ca --experimental-strip-types scripts/scan-agency-numbers.ts <agency-id-or-slug>');
  process.exit(1);
}

const vb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'vb' }, auth: { persistSession: false, autoRefreshToken: false } },
);

function basicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

interface IncomingPhoneNumber {
  sid: string;
  phone_number: string;
  trunk_sid: string | null;
  voice_url: string | null;
  voice_application_sid: string | null;
  status_callback: string | null;
  friendly_name: string | null;
}

async function main() {
  // Resolve agency by UUID or slug
  const isUuid = /^[0-9a-f-]{36}$/i.test(arg);
  const { data: agency } = await vb
    .from('agencies')
    .select('id, name, slug, twilio_account_sid, twilio_auth_token')
    .eq(isUuid ? 'id' : 'slug', arg)
    .maybeSingle<{
      id: string;
      name: string;
      slug: string;
      twilio_account_sid: string | null;
      twilio_auth_token: string | null;
    }>();
  if (!agency) {
    console.error(`No agency with ${isUuid ? 'id' : 'slug'}='${arg}'`);
    process.exit(1);
  }
  console.log(`\nAgency: ${agency.name} (slug=${agency.slug}, id=${agency.id})`);

  const sid = agency.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID!;
  const token = agency.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN!;
  const credsSource = agency.twilio_account_sid ? 'agency override' : 'platform env';
  console.log(`Twilio account: ${sid.slice(0, 8)}…  (${credsSource})`);

  // Load all bots in this agency with a phone number
  const { data: bots, error } = await vb
    .from('bots')
    .select('id, status, agent_id, phone_e164, client_subscription_status, created_at')
    .eq('agency_id', agency.id)
    .not('phone_e164', 'is', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('vb.bots query failed:', error.message);
    process.exit(1);
  }
  if (!bots || bots.length === 0) {
    console.log('\nNo bots with phone numbers in this agency.');
    return;
  }
  console.log(`\nFound ${bots.length} bot(s) with phone numbers. Checking each in Twilio…\n`);
  console.log('='.repeat(90));

  const agencyAuth = basicAuth(sid, token);
  const platformSid = process.env.TWILIO_ACCOUNT_SID!;
  const platformToken = process.env.TWILIO_AUTH_TOKEN!;
  const platformAuth = basicAuth(platformSid, platformToken);
  const hasPlatformFallback = agency.twilio_account_sid && platformSid !== sid;

  async function lookup(phone: string, useSid: string, useAuth: string) {
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${useSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`,
      { headers: { Authorization: useAuth } },
    );
    if (!r.ok) return { ok: false as const, status: r.status };
    const data = (await r.json()) as { incoming_phone_numbers?: IncomingPhoneNumber[] };
    return { ok: true as const, rec: data.incoming_phone_numbers?.find((n) => n.phone_number === phone) };
  }

  const issues: Array<{
    phone: string;
    botId: string;
    agentId: string | null;
    status: string;
    problems: string[];
  }> = [];

  for (const bot of bots) {
    const phone = bot.phone_e164 as string;
    process.stdout.write(`  ${phone}  (bot=${bot.id.slice(0, 8)}…, status=${bot.status})  `);

    // 1. Look in agency sub-account first
    let rec: IncomingPhoneNumber | undefined;
    let foundIn = 'agency';
    const agencyResult = await lookup(phone, sid, agencyAuth);
    if (!agencyResult.ok) {
      console.log(`✗ Twilio lookup ${agencyResult.status}`);
      issues.push({
        phone,
        botId: bot.id as string,
        agentId: bot.agent_id as string | null,
        status: bot.status as string,
        problems: [`Twilio lookup failed (${agencyResult.status})`],
      });
      continue;
    }
    rec = agencyResult.rec;

    // 2. Not in agency sub-account? Try platform.
    if (!rec && hasPlatformFallback) {
      const platformResult = await lookup(phone, platformSid, platformAuth);
      if (platformResult.ok && platformResult.rec) {
        rec = platformResult.rec;
        foundIn = 'platform';
      }
    }

    if (!rec) {
      console.log('✗ NOT IN TWILIO (neither sub-account nor platform)');
      issues.push({
        phone,
        botId: bot.id as string,
        agentId: bot.agent_id as string | null,
        status: bot.status as string,
        problems: ['Number not present in either the agency sub-account or the platform Twilio account'],
      });
      continue;
    }

    const problems: string[] = [];
    if (!rec.trunk_sid) problems.push('no trunk_sid (not wired to Retell)');
    if (rec.voice_url) problems.push(`voice_url set → ${rec.voice_url}`);
    if (rec.voice_application_sid) problems.push(`voice_application_sid set → ${rec.voice_application_sid}`);
    if (rec.status_callback) problems.push(`status_callback set → ${rec.status_callback}`);
    if (!bot.agent_id) problems.push('bot.agent_id is null (Retell never deployed)');
    if (foundIn === 'platform') {
      problems.push('owned by PLATFORM Twilio account, not the agency sub-account (revenue/billing wrong account)');
    }

    if (problems.length === 0) {
      console.log('✓ clean');
    } else {
      console.log(`⚠ ${problems.length} issue(s) [in ${foundIn}]`);
      issues.push({
        phone,
        botId: bot.id as string,
        agentId: bot.agent_id as string | null,
        status: bot.status as string,
        problems,
      });
    }
  }

  console.log('='.repeat(90));
  if (issues.length === 0) {
    console.log('\n✓ All numbers are cleanly wired. No action needed.');
    return;
  }

  console.log(`\n⚠ ${issues.length} number(s) need attention:\n`);
  for (const i of issues) {
    console.log(`  ${i.phone}  (bot ${i.botId}, status=${i.status})`);
    for (const p of i.problems) {
      console.log(`    - ${p}`);
    }
    console.log(`    Fix: node --use-system-ca --experimental-strip-types scripts/link-phone-number.ts ${i.phone}`);
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
