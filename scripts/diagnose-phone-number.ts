// Usage:
//   node --experimental-strip-types scripts/diagnose-phone-number.ts <phone-e164>
//
// Example:
//   node --experimental-strip-types scripts/diagnose-phone-number.ts +447862132038
//
// Walks the full inbound-call chain for a given number and tells you exactly
// where it's broken:
//
//   PSTN → Twilio number → Twilio Elastic SIP Trunk → Retell SIP → Retell agent
//
// Checks performed:
//   A. vb.bots row: does a bot own this phone_e164? status, agent_id, llm_id, agency
//   B. Twilio: IncomingPhoneNumber exists in this account, has trunk_sid, voice_url
//      not set (would short-circuit the trunk), trunk has Retell origination URI
//   C. Retell: phone number is imported, has inbound_agents bound, agent exists
//
// Read-only against all three providers. Safe to run against prod.

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
  } catch {
    // .env.local missing — fall through
  }
}

loadEnv();

const phone = process.argv[2]?.trim();
if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
  console.error('Usage: node --experimental-strip-types scripts/diagnose-phone-number.ts +447862132038');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const retellKey = process.env.RETELL_API_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!retellKey) {
  console.error('Missing RETELL_API_KEY in .env.local');
  process.exit(1);
}

const platformSid = process.env.TWILIO_ACCOUNT_SID;
const platformToken = process.env.TWILIO_AUTH_TOKEN;
if (!platformSid || !platformToken) {
  console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in .env.local');
  process.exit(1);
}

const vb = createClient(supabaseUrl, serviceKey, {
  db: { schema: 'vb' },
  auth: { persistSession: false, autoRefreshToken: false },
});

function basicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

interface BotRow {
  id: string;
  agency_id: string;
  status: string;
  agent_id: string | null;
  llm_id: string | null;
  phone_e164: string | null;
  client_subscription_status: string;
  created_at: string;
}

interface IncomingPhoneNumber {
  sid: string;
  phone_number: string;
  trunk_sid: string | null;
  voice_url: string | null;
  voice_application_sid: string | null;
  status_callback: string | null;
  friendly_name: string | null;
  account_sid: string;
}

interface Trunk {
  sid: string;
  domain_name: string | null;
  friendly_name: string | null;
}

interface OriginationUrl {
  sip_url: string;
  enabled: boolean;
  priority: number;
  weight: number;
}

async function main() {
  console.log(`\nDiagnosing inbound-call chain for ${phone}\n`);
  console.log('='.repeat(70));

  // ---------------------------------------------------------------------------
  // A. vb.bots — is there a bot row owning this number?
  // ---------------------------------------------------------------------------
  console.log('\n=== A. vb.bots ===');
  const { data: bot, error: botErr } = await vb
    .from('bots')
    .select('id, agency_id, status, agent_id, llm_id, phone_e164, client_subscription_status, created_at')
    .eq('phone_e164', phone)
    .maybeSingle<BotRow>();

  if (botErr) {
    console.error('  Query error:', botErr.message);
  }

  let dbAgentId: string | null = null;
  let agencyId: string | null = null;
  if (!bot) {
    console.log(`  ✗ No vb.bots row with phone_e164='${phone}'.`);
    console.log('    The number isn\'t owned by any bot in this Supabase project.');
    console.log('    → either the bot was deleted, or the number was bought outside the app.');
  } else {
    console.log(`  ✓ Bot found.`);
    console.log(`    bot.id:                       ${bot.id}`);
    console.log(`    bot.agency_id:                ${bot.agency_id}`);
    console.log(`    bot.status:                   ${bot.status}`);
    console.log(`    bot.agent_id (Retell):        ${bot.agent_id ?? '— (NOT DEPLOYED)'}`);
    console.log(`    bot.llm_id (Retell):          ${bot.llm_id ?? '—'}`);
    console.log(`    bot.client_subscription:      ${bot.client_subscription_status}`);
    console.log(`    bot.created_at:               ${bot.created_at}`);
    dbAgentId = bot.agent_id;
    agencyId = bot.agency_id;
    if (bot.status !== 'live') {
      console.log(`    ⚠ status is '${bot.status}', not 'live' — typically only live bots accept calls.`);
    }
    if (!bot.agent_id) {
      console.log('    ⚠ agent_id is NULL — Retell deploy never ran. Calls have nowhere to land.');
    }
  }

  // ---------------------------------------------------------------------------
  // Resolve which Twilio account this number lives on (per-agency override?)
  // ---------------------------------------------------------------------------
  let twilioSid = platformSid;
  let twilioToken = platformToken;
  let credsSource = 'platform env';
  if (agencyId) {
    const { data: agencyCreds } = await vb
      .from('agencies')
      .select('twilio_account_sid, twilio_auth_token, name')
      .eq('id', agencyId)
      .maybeSingle<{
        twilio_account_sid: string | null;
        twilio_auth_token: string | null;
        name: string;
      }>();
    if (agencyCreds?.twilio_account_sid && agencyCreds?.twilio_auth_token) {
      twilioSid = agencyCreds.twilio_account_sid;
      twilioToken = agencyCreds.twilio_auth_token;
      credsSource = `agency override (${agencyCreds.name})`;
    } else if (agencyCreds) {
      credsSource = `platform env (agency ${agencyCreds.name} has no override)`;
    }
  }

  // ---------------------------------------------------------------------------
  // B. Twilio — IncomingPhoneNumber + trunk wiring
  // ---------------------------------------------------------------------------
  console.log(`\n=== B. Twilio (account ${twilioSid.slice(0, 8)}…, source: ${credsSource}) ===`);

  const auth = basicAuth(twilioSid!, twilioToken!);
  const lookupUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`;
  const lookupRes = await fetch(lookupUrl, { headers: { Authorization: auth } });
  if (!lookupRes.ok) {
    const detail = await lookupRes.text().catch(() => '');
    console.error(`  ✗ Twilio lookup returned ${lookupRes.status}`);
    console.error(`    detail: ${detail.slice(0, 300)}`);
    return;
  }
  const lookupData = (await lookupRes.json()) as { incoming_phone_numbers?: IncomingPhoneNumber[] };
  const numberRecord = lookupData.incoming_phone_numbers?.find((n) => n.phone_number === phone);

  if (!numberRecord) {
    console.log(`  ✗ No IncomingPhoneNumber for ${phone} in this Twilio account.`);
    console.log(`    → Either it was released, or it lives on a different sub-account.`);
    return;
  }

  console.log(`  ✓ Number exists in Twilio.`);
  console.log(`    phone_number_sid:  ${numberRecord.sid}`);
  console.log(`    friendly_name:     ${numberRecord.friendly_name ?? '—'}`);
  console.log(`    trunk_sid:         ${numberRecord.trunk_sid ?? '— (NOT ATTACHED TO A TRUNK)'}`);
  console.log(`    voice_url:         ${numberRecord.voice_url || '— (none)'}`);
  console.log(`    voice_application_sid: ${numberRecord.voice_application_sid ?? '—'}`);

  if (!numberRecord.trunk_sid) {
    console.log('\n  ✗ Number is NOT on a SIP trunk.');
    console.log('    Inbound calls will either hit voice_url (if set) or return a "no app" error.');
    console.log(`    Fix: POST /api/twilio/link with {phone_e164: "${phone}", agent_id: "${dbAgentId ?? '<bot.agent_id>'}"}`);
    return;
  }

  if (numberRecord.voice_url) {
    console.log('\n  ⚠ voice_url is set on the number itself.');
    console.log('    On Twilio, when a number is on a trunk the trunk normally handles it,');
    console.log('    but if voice_url is set it may take precedence and break the SIP route.');
  }

  // Fetch the trunk
  const trunkRes = await fetch(`https://trunking.twilio.com/v1/Trunks/${numberRecord.trunk_sid}`, {
    headers: { Authorization: auth },
  });
  if (!trunkRes.ok) {
    console.error(`  ✗ Couldn't fetch trunk ${numberRecord.trunk_sid} — ${trunkRes.status}`);
    return;
  }
  const trunk = (await trunkRes.json()) as Trunk;
  console.log(`\n  Trunk:`);
  console.log(`    sid:           ${trunk.sid}`);
  console.log(`    domain_name:   ${trunk.domain_name ?? '— (MISSING)'}`);
  console.log(`    friendly_name: ${trunk.friendly_name ?? '—'}`);

  if (!trunk.domain_name) {
    console.log('  ⚠ Trunk has no domain_name — Retell can\'t route calls back to it.');
  }

  // Origination URLs — must include sip:sip.retellai.com
  const urlsRes = await fetch(
    `https://trunking.twilio.com/v1/Trunks/${trunk.sid}/OriginationUrls`,
    { headers: { Authorization: auth } },
  );
  if (!urlsRes.ok) {
    console.error(`  ✗ Couldn't fetch origination URLs — ${urlsRes.status}`);
    return;
  }
  const urlsData = (await urlsRes.json()) as { origination_urls?: OriginationUrl[] };
  const urls = urlsData.origination_urls ?? [];
  console.log(`\n  Origination URLs on this trunk (${urls.length}):`);
  for (const u of urls) {
    console.log(`    - ${u.sip_url}  enabled=${u.enabled}  priority=${u.priority}  weight=${u.weight}`);
  }
  const hasRetell = urls.some((u) => u.sip_url === 'sip:sip.retellai.com' && u.enabled !== false);
  if (!hasRetell) {
    console.log('  ✗ sip:sip.retellai.com is NOT a working origination URL on this trunk.');
    console.log('    Twilio has nowhere to send inbound SIP traffic → call rings then drops.');
    console.log(`    Fix: re-run /api/twilio/link.`);
    return;
  } else {
    console.log('  ✓ Retell origination URI is present and enabled.');
  }

  // ---------------------------------------------------------------------------
  // C. Retell — phone number import + agent binding
  // ---------------------------------------------------------------------------
  console.log('\n=== C. Retell ===');
  const retellBase = process.env.RETELL_API_BASE || 'https://api.retellai.com';

  const retellNumRes = await fetch(`${retellBase}/get-phone-number/${encodeURIComponent(phone)}`, {
    headers: { Authorization: `Bearer ${retellKey}` },
  });
  if (retellNumRes.status === 404) {
    console.log(`  ✗ Retell has no record of ${phone}.`);
    console.log('    → /api/twilio/link\'s step 5 (import) never succeeded.');
    console.log('    Fix: POST /api/twilio/link again with the same phone + agent_id.');
    return;
  }
  if (!retellNumRes.ok) {
    console.error(`  ✗ Retell get-phone-number returned ${retellNumRes.status}`);
    console.error(`    detail: ${(await retellNumRes.text().catch(() => '')).slice(0, 400)}`);
    return;
  }
  const retellNum = (await retellNumRes.json()) as {
    phone_number: string;
    inbound_agent_id?: string | null;
    inbound_agents?: Array<{ agent_id: string; weight?: number }>;
    termination_uri?: string;
    nickname?: string;
  };
  console.log(`  ✓ Number is imported in Retell.`);
  console.log(`    nickname:          ${retellNum.nickname ?? '—'}`);
  console.log(`    termination_uri:   ${retellNum.termination_uri ?? '—'}`);
  console.log(`    inbound_agent_id:  ${retellNum.inbound_agent_id ?? '—'}`);
  if (retellNum.inbound_agents) {
    console.log(`    inbound_agents:    ${JSON.stringify(retellNum.inbound_agents)}`);
  }

  if (trunk.domain_name && retellNum.termination_uri && trunk.domain_name !== retellNum.termination_uri) {
    console.log(`  ⚠ termination_uri (${retellNum.termination_uri}) doesn't match trunk domain (${trunk.domain_name}).`);
    console.log('    Retell would try to send call back to the wrong host.');
  }

  const boundAgentId =
    retellNum.inbound_agent_id ??
    retellNum.inbound_agents?.[0]?.agent_id ??
    null;

  if (!boundAgentId) {
    console.log('  ✗ No inbound agent bound to this number in Retell.');
    console.log('    Call connects to Retell but Retell doesn\'t know which agent to run.');
    return;
  }

  if (dbAgentId && boundAgentId !== dbAgentId) {
    console.log(`  ⚠ Retell binds the number to agent ${boundAgentId}, but vb.bots.agent_id is ${dbAgentId}.`);
    console.log('    Out-of-sync — the user may hear the wrong (or no) bot.');
  }

  // Confirm the agent actually exists in Retell
  const agentRes = await fetch(`${retellBase}/get-agent/${encodeURIComponent(boundAgentId)}`, {
    headers: { Authorization: `Bearer ${retellKey}` },
  });
  if (agentRes.status === 404) {
    console.log(`  ✗ Retell agent ${boundAgentId} does not exist.`);
    console.log('    The agent was deleted but the number still points at it → call dies.');
    return;
  }
  if (!agentRes.ok) {
    console.error(`  ✗ Retell get-agent returned ${agentRes.status}`);
    return;
  }
  const agent = (await agentRes.json()) as {
    agent_id: string;
    agent_name?: string;
    response_engine?: { type: string; llm_id?: string };
    voice_id?: string;
  };
  console.log(`  ✓ Retell agent exists.`);
  console.log(`    agent_id:    ${agent.agent_id}`);
  console.log(`    agent_name:  ${agent.agent_name ?? '—'}`);
  console.log(`    voice_id:    ${agent.voice_id ?? '—'}`);
  console.log(`    llm_id:      ${agent.response_engine?.llm_id ?? '—'}`);

  console.log('\n=== Verdict ===');
  console.log('  Every link in the chain checks out. If calls still fail:');
  console.log('   - Check Twilio Console → Monitor → Calls for this number — what status code?');
  console.log('     "no-answer" / "completed 0s" → Retell side; "failed" → Twilio routing.');
  console.log('   - Check Retell Dashboard → Calls for an inbound call attempt at the right time.');
  console.log('   - If neither shows the call, it never reached Twilio (carrier/dial issue).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
