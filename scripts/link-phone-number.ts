// Usage:
//   node --use-system-ca --experimental-strip-types scripts/link-phone-number.ts <phone-e164>
//
// Example:
//   node --use-system-ca --experimental-strip-types scripts/link-phone-number.ts +441249471556
//
// Wires a Twilio number end-to-end to its Retell agent. Mirrors the live
// /api/twilio/link route (app/api/twilio/link/route.ts) but runs from the
// terminal so we don't need the dev server up:
//
//   1. Looks up vb.bots by phone_e164 → resolves agent_id + agency_id
//   2. Resolves Twilio creds (agency override → platform env fallback)
//   3. Looks up the IncomingPhoneNumber in Twilio
//   4. Reuses existing trunk or creates a fresh one
//   5. Ensures sip:sip.retellai.com is on the trunk as an origination URI
//   6. Attaches the number to the trunk
//   7. Clears voice_url, voice_fallback_url, voice_application_sid,
//      status_callback (so GHL or any prior webhook can't hijack calls)
//   8. Imports the number into Retell with inbound_agents bound to agent_id
//      (or updates the binding if it's already imported)
//
// Idempotent — running it twice on the same number is a no-op.

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

const phone = process.argv[2]?.trim();
if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
  console.error('Usage: node --use-system-ca --experimental-strip-types scripts/link-phone-number.ts +441249471556');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const retellKey = process.env.RETELL_API_KEY!;
const platformSid = process.env.TWILIO_ACCOUNT_SID!;
const platformToken = process.env.TWILIO_AUTH_TOKEN!;

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TWILIO_TRUNKING = 'https://trunking.twilio.com/v1';
const RETELL_BASE = process.env.RETELL_API_BASE || 'https://api.retellai.com';
const RETELL_ORIGINATION_URI = 'sip:sip.retellai.com';

const vb = createClient(supabaseUrl, serviceKey, {
  db: { schema: 'vb' },
  auth: { persistSession: false, autoRefreshToken: false },
});

function basicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

function buildDomainSlug(agentId: string): string {
  const idTail = agentId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-12);
  const suffix = Math.random().toString(16).slice(2, 8);
  return `retell-${idTail}-${suffix}`;
}

interface Trunk {
  sid: string;
  domain_name: string | null;
  friendly_name: string | null;
}

async function main() {
  console.log(`\nLinking ${phone} to its Retell agent\n`);
  console.log('='.repeat(70));

  // -------------------------------------------------------------------------
  // 1. Resolve bot → agent_id + agency_id
  // -------------------------------------------------------------------------
  const { data: bot, error: botErr } = await vb
    .from('bots')
    .select('id, agency_id, status, agent_id, phone_e164')
    .eq('phone_e164', phone)
    .maybeSingle<{ id: string; agency_id: string; status: string; agent_id: string | null; phone_e164: string }>();
  if (botErr || !bot) {
    console.error(`✗ No vb.bots row with phone_e164='${phone}': ${botErr?.message ?? 'not found'}`);
    process.exit(1);
  }
  if (!bot.agent_id) {
    console.error(`✗ Bot ${bot.id} has no agent_id — Retell deploy hasn't run yet. Aborting.`);
    process.exit(1);
  }
  const agentId = bot.agent_id;
  const agencyId = bot.agency_id;
  console.log(`Bot: ${bot.id} (status=${bot.status})`);
  console.log(`Agent: ${agentId}`);

  // -------------------------------------------------------------------------
  // 2. Resolve Twilio creds (agency override > platform env)
  // -------------------------------------------------------------------------
  const { data: agency } = await vb
    .from('agencies')
    .select('name, twilio_account_sid, twilio_auth_token')
    .eq('id', agencyId)
    .maybeSingle<{ name: string; twilio_account_sid: string | null; twilio_auth_token: string | null }>();

  const sid = agency?.twilio_account_sid || platformSid;
  const token = agency?.twilio_auth_token || platformToken;
  const credsSource = agency?.twilio_account_sid ? `agency override (${agency.name})` : 'platform env';
  console.log(`Twilio account: ${sid.slice(0, 8)}…  (source: ${credsSource})\n`);

  const auth = basicAuth(sid, token);

  // -------------------------------------------------------------------------
  // 3. Look up the Twilio IncomingPhoneNumber
  // -------------------------------------------------------------------------
  console.log('[1/5] Looking up Twilio number…');
  const lookupRes = await fetch(
    `${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`,
    { headers: { Authorization: auth } },
  );
  if (!lookupRes.ok) {
    console.error(`  ✗ Lookup failed: ${lookupRes.status} ${await lookupRes.text().catch(() => '')}`);
    process.exit(1);
  }
  const lookupData = (await lookupRes.json()) as {
    incoming_phone_numbers?: Array<{ sid: string; phone_number: string; trunk_sid: string | null; voice_url: string | null }>;
  };
  const numberRecord = lookupData.incoming_phone_numbers?.find((n) => n.phone_number === phone);
  if (!numberRecord) {
    console.error(`  ✗ No IncomingPhoneNumber matching ${phone} in this Twilio account.`);
    process.exit(1);
  }
  const phoneNumberSid = numberRecord.sid;
  console.log(`  ✓ ${phoneNumberSid}  (trunk_sid=${numberRecord.trunk_sid ?? 'none'}, voice_url=${numberRecord.voice_url || 'none'})`);

  // -------------------------------------------------------------------------
  // 4. Resolve / create trunk
  // -------------------------------------------------------------------------
  console.log('[2/5] Resolving SIP trunk…');
  let trunkSid: string;
  let trunkDomain: string;

  if (numberRecord.trunk_sid) {
    const r = await fetch(`${TWILIO_TRUNKING}/Trunks/${numberRecord.trunk_sid}`, { headers: { Authorization: auth } });
    if (!r.ok) {
      console.error(`  ✗ Couldn't read existing trunk ${numberRecord.trunk_sid}: ${r.status}`);
      process.exit(1);
    }
    const t = (await r.json()) as Trunk;
    trunkSid = t.sid;
    trunkDomain = t.domain_name ?? '';
    console.log(`  ✓ reusing ${trunkSid} (${trunkDomain || 'no domain yet'})`);
    if (!trunkDomain) {
      const desired = `${buildDomainSlug(agentId)}.pstn.twilio.com`;
      const pr = await fetch(`${TWILIO_TRUNKING}/Trunks/${trunkSid}`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ DomainName: desired }).toString(),
      });
      if (!pr.ok) {
        console.error(`  ✗ Couldn't patch trunk domain: ${pr.status} ${await pr.text().catch(() => '')}`);
        process.exit(1);
      }
      trunkDomain = ((await pr.json()) as Trunk).domain_name ?? desired;
      console.log(`    patched domain → ${trunkDomain}`);
    }
  } else {
    const desired = `${buildDomainSlug(agentId)}.pstn.twilio.com`;
    const cr = await fetch(`${TWILIO_TRUNKING}/Trunks`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        FriendlyName: `retell-${agentId.slice(-10)}`,
        DomainName: desired,
      }).toString(),
    });
    if (!cr.ok) {
      console.error(`  ✗ Trunk create failed: ${cr.status} ${await cr.text().catch(() => '')}`);
      process.exit(1);
    }
    const t = (await cr.json()) as Trunk;
    trunkSid = t.sid;
    trunkDomain = t.domain_name ?? desired;
    console.log(`  ✓ created ${trunkSid} (${trunkDomain})`);
  }

  // -------------------------------------------------------------------------
  // 5. Ensure Retell origination URI is on the trunk
  // -------------------------------------------------------------------------
  console.log('[3/5] Ensuring Retell origination URI…');
  const urlsRes = await fetch(`${TWILIO_TRUNKING}/Trunks/${trunkSid}/OriginationUrls`, {
    headers: { Authorization: auth },
  });
  const urlsData = (await urlsRes.json()) as { origination_urls?: Array<{ sip_url?: string; enabled?: boolean }> };
  const has = (urlsData.origination_urls ?? []).some(
    (u) => u.sip_url === RETELL_ORIGINATION_URI && u.enabled !== false,
  );
  if (has) {
    console.log('  ✓ already present');
  } else {
    const addRes = await fetch(`${TWILIO_TRUNKING}/Trunks/${trunkSid}/OriginationUrls`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        FriendlyName: 'Retell',
        SipUrl: RETELL_ORIGINATION_URI,
        Priority: '10',
        Weight: '10',
        Enabled: 'true',
      }).toString(),
    });
    if (!addRes.ok) {
      console.error(`  ✗ Couldn't add origination URI: ${addRes.status} ${await addRes.text().catch(() => '')}`);
      process.exit(1);
    }
    console.log('  ✓ added');
  }

  // -------------------------------------------------------------------------
  // 6. Attach number to trunk + clear voice_url in the same PATCH
  // -------------------------------------------------------------------------
  console.log('[4/5] Attaching number to trunk + clearing voice_url…');
  // The IncomingPhoneNumber resource accepts TrunkSid directly, so we can do
  // both moves in one PATCH instead of two round-trips.
  const attachRes = await fetch(`${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers/${phoneNumberSid}.json`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      TrunkSid: trunkSid,
      VoiceUrl: '',
      VoiceFallbackUrl: '',
      VoiceApplicationSid: '',
      StatusCallback: '',
    }).toString(),
  });
  if (!attachRes.ok) {
    console.error(`  ✗ Attach failed: ${attachRes.status} ${await attachRes.text().catch(() => '')}`);
    process.exit(1);
  }
  const updated = (await attachRes.json()) as Record<string, unknown>;
  console.log(`  ✓ trunk_sid=${updated.trunk_sid}, voice_url=${updated.voice_url || '(empty)'}, status_callback=${updated.status_callback || '(empty)'}`);

  // -------------------------------------------------------------------------
  // 7. Import number into Retell (or update inbound_agents if already there)
  // -------------------------------------------------------------------------
  console.log('[5/5] Registering number in Retell…');
  const nickname = `retell-${agentId.slice(-10)}`;
  const importRes = await fetch(`${RETELL_BASE}/import-phone-number`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${retellKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: phone,
      termination_uri: trunkDomain,
      nickname,
      inbound_agents: [{ agent_id: agentId, weight: 1 }],
    }),
  });
  if (importRes.ok) {
    console.log('  ✓ imported');
  } else {
    const detail = await importRes.text().catch(() => '');
    const alreadyImported =
      importRes.status === 400 &&
      (/already.*import/i.test(detail) ||
        /phone[_ ]number.*(exists|imported)/i.test(detail) ||
        /already\s+exists/i.test(detail));
    if (!alreadyImported) {
      console.error(`  ✗ Retell import failed: ${importRes.status} ${detail}`);
      process.exit(1);
    }
    // Already imported — fall back to update-phone-number.
    const updateRes = await fetch(`${RETELL_BASE}/update-phone-number/${encodeURIComponent(phone)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${retellKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname,
        inbound_agents: [{ agent_id: agentId, weight: 1 }],
      }),
    });
    if (!updateRes.ok) {
      console.error(`  ✗ Retell update failed: ${updateRes.status} ${await updateRes.text().catch(() => '')}`);
      process.exit(1);
    }
    console.log('  ✓ updated existing import');
  }

  console.log('\n✓ All steps complete. Re-run scripts/diagnose-phone-number.ts to verify.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
