import { NextResponse } from 'next/server';
import { resolveTwilioCredentials, basicAuth as makeTwilioAuth } from '@/lib/twilio/resolve';

// POST /api/twilio/link
//
// Body: { phone_e164: string, agent_id: string, nickname?: string }
//
// End-to-end wiring of a Twilio number to a Retell agent via Elastic SIP Trunk.
// Designed to be **idempotent** — calling it multiple times for the same
// (phone, agent) pair won't error out and will converge on the correct state:
//
//   1. Look up the Twilio IncomingPhoneNumber and its current trunk_sid.
//   2. Reuse the existing trunk if attached; otherwise create a new one
//      with origination URI = sip:sip.retellai.com and move the number into it.
//   3. Ensure the Retell origination URI is present on the trunk.
//   4. Ensure the phone number is attached to the trunk.
//   5. Tell Retell to import the number; if it's already imported, update
//      its inbound_agents instead.
//
// Each step logs to console.error on failure so the dev terminal shows the
// upstream provider's error message verbatim. The HTTP response carries the
// same info structured under `failed_at` + `detail`.

export const runtime = 'nodejs';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TWILIO_TRUNKING = 'https://trunking.twilio.com/v1';
const RETELL_DEFAULT_BASE = 'https://api.retellai.com';
const RETELL_ORIGINATION_URI = 'sip:sip.retellai.com';

interface LinkBody {
  phone_e164: string;
  agent_id: string;
  nickname?: string;
  agency_id?: string;
}

interface StepLog {
  step: string;
  ok: boolean;
  detail?: string;
}

interface IncomingPhoneNumber {
  sid: string;
  phone_number: string;
  trunk_sid: string | null;
}

interface Trunk {
  sid: string;
  domain_name: string | null;
}

export async function POST(req: Request) {
  const retellKey = process.env.RETELL_API_KEY;
  if (!retellKey) {
    return NextResponse.json(
      { error: 'RETELL_API_KEY must be set on the server.' },
      { status: 500 },
    );
  }

  let body: LinkBody;
  try {
    body = (await req.json()) as LinkBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const phone = body?.phone_e164?.trim();
  const agentId = body?.agent_id?.trim();
  const agencyId = body?.agency_id?.trim();

  let sid: string;
  let token: string;
  try {
    if (agencyId) {
      const creds = await resolveTwilioCredentials(agencyId);
      sid = creds.sid;
      token = creds.token;
    } else {
      sid = process.env.TWILIO_ACCOUNT_SID ?? '';
      token = process.env.TWILIO_AUTH_TOKEN ?? '';
    }
    if (!sid || !token) throw new Error('missing');
  } catch {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set on the server.' },
      { status: 500 },
    );
  }
  if (!phone || !agentId) {
    return NextResponse.json(
      { error: 'phone_e164 and agent_id are required.' },
      { status: 400 },
    );
  }
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    return NextResponse.json(
      { error: 'phone_e164 must be a valid E.164 number (e.g. +441234567890).' },
      { status: 400 },
    );
  }

  const nickname = (body.nickname || `retell-${agentId.slice(-10)}`).slice(0, 64);
  const twilioAuth = makeTwilioAuth(sid, token);
  const log: StepLog[] = [];

  // ---------------------------------------------------------------------------
  // 1. Look up the IncomingPhoneNumber + its current trunk_sid
  // ---------------------------------------------------------------------------
  const lookupUrl = `${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`;
  const lookupRes = await fetch(lookupUrl, { headers: { Authorization: twilioAuth } });
  if (!lookupRes.ok) {
    const detail = await lookupRes.text().catch(() => '');
    return fail('lookup_number', `Twilio lookup returned ${lookupRes.status}`, detail, log);
  }
  const lookupData = (await lookupRes.json()) as {
    incoming_phone_numbers?: IncomingPhoneNumber[];
  };
  const numberRecord = lookupData.incoming_phone_numbers?.find((n) => n.phone_number === phone);
  if (!numberRecord) {
    return fail(
      'lookup_number',
      `No Twilio number matching ${phone} was found in this account.`,
      undefined,
      log,
    );
  }
  const phoneNumberSid = numberRecord.sid;
  log.push({ step: 'lookup_number', ok: true, detail: phoneNumberSid });

  // ---------------------------------------------------------------------------
  // 2. Resolve the trunk — reuse existing or create fresh
  // ---------------------------------------------------------------------------
  let trunkSid: string;
  let trunkDomain: string;

  if (numberRecord.trunk_sid) {
    // Number already lives on a trunk. Reuse it instead of trying to create
    // a new one (which would 409 anyway when we tried to attach the number).
    const existing = await fetchTrunk(twilioAuth, numberRecord.trunk_sid);
    if (!existing.ok) {
      return fail(
        'reuse_trunk',
        `Couldn't read the existing trunk that the number is attached to.`,
        existing.detail,
        log,
      );
    }
    trunkSid = existing.trunk.sid;
    trunkDomain = existing.trunk.domain_name ?? '';
    log.push({
      step: 'reuse_trunk',
      ok: true,
      detail: `${trunkSid} (${trunkDomain || 'no domain yet'})`,
    });

    // Patch the trunk if it doesn't have a domain (older orphans from failed runs).
    if (!trunkDomain) {
      const patched = await patchTrunkDomain(twilioAuth, trunkSid, buildDomainSlug(agentId));
      if (!patched.ok) {
        return fail(
          'patch_trunk_domain',
          `Couldn't set a domain on the existing trunk.`,
          patched.detail,
          log,
          { trunk_sid: trunkSid },
        );
      }
      trunkDomain = patched.domain;
      log.push({
        step: 'patch_trunk_domain',
        ok: true,
        detail: trunkDomain,
      });
    }
  } else {
    // Number isn't on a trunk yet. Create a fresh one.
    const created = await createTrunk(twilioAuth, nickname, buildDomainSlug(agentId));
    if (!created.ok) {
      return fail('create_trunk', `Twilio trunk create returned ${created.status}`, created.detail, log);
    }
    trunkSid = created.trunk.sid;
    trunkDomain = created.trunk.domain_name ?? '';
    log.push({
      step: 'create_trunk',
      ok: true,
      detail: `${trunkSid} (${trunkDomain})`,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Ensure the Retell origination URI is on the trunk
  // ---------------------------------------------------------------------------
  const ensureOrigin = await ensureRetellOriginationUri(twilioAuth, trunkSid);
  if (!ensureOrigin.ok) {
    return fail(
      'add_origination_uri',
      ensureOrigin.message,
      ensureOrigin.detail,
      log,
      { trunk_sid: trunkSid },
    );
  }
  log.push({ step: 'add_origination_uri', ok: true, detail: ensureOrigin.note });

  // ---------------------------------------------------------------------------
  // 4. Attach number to the trunk AND blank any legacy webhook handlers
  //
  // PATCH the IncomingPhoneNumber directly (not POST /Trunks/{sid}/PhoneNumbers)
  // so we can set TrunkSid + clear VoiceUrl/VoiceFallbackUrl/VoiceApplicationSid/
  // StatusCallback in one round-trip. Numbers that were previously owned by
  // GoHighLevel, a Studio Flow, or any other webhook-based handler keep their
  // voice_url pointing at the old endpoint even after being moved to a trunk —
  // which silently hijacks inbound calls. Wiping all four fields here forces
  // the trunk to be the sole inbound handler.
  // ---------------------------------------------------------------------------
  const needsAttach = numberRecord.trunk_sid !== trunkSid;
  const attachRes = await fetch(
    `${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers/${phoneNumberSid}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: twilioAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        TrunkSid: trunkSid,
        VoiceUrl: '',
        VoiceFallbackUrl: '',
        VoiceApplicationSid: '',
        StatusCallback: '',
      }).toString(),
    },
  );
  if (!attachRes.ok) {
    const detail = await attachRes.text().catch(() => '');
    return fail(
      needsAttach ? 'attach_phone_number' : 'clear_voice_url',
      `Twilio number PATCH returned ${attachRes.status}`,
      detail,
      log,
      { trunk_sid: trunkSid },
    );
  }
  log.push({
    step: 'attach_phone_number',
    ok: true,
    detail: needsAttach ? 'attached + cleared voice_url' : 'already attached, cleared voice_url',
  });

  // ---------------------------------------------------------------------------
  // 5. Register / update the number in Retell
  // ---------------------------------------------------------------------------
  const retellBase = process.env.RETELL_API_BASE || RETELL_DEFAULT_BASE;
  const importResult = await importOrUpdateRetellNumber({
    retellKey,
    retellBase,
    phone,
    trunkDomain,
    nickname,
    agentId,
  });
  if (!importResult.ok) {
    return fail(
      'retell_import',
      importResult.message,
      importResult.detail,
      log,
      { trunk_sid: trunkSid, termination_uri: trunkDomain },
    );
  }
  log.push({ step: 'retell_import', ok: true, detail: importResult.note });

  return NextResponse.json({
    ok: true,
    phone_number_sid: phoneNumberSid,
    trunk_sid: trunkSid,
    termination_uri: trunkDomain,
    agent_id: agentId,
    log,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDomainSlug(agentId: string): string {
  const idTail = agentId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-12);
  const suffix = Math.random().toString(16).slice(2, 8);
  return `retell-${idTail}-${suffix}`;
}

async function fetchTrunk(
  auth: string,
  trunkSid: string,
): Promise<{ ok: true; trunk: Trunk } | { ok: false; detail: string }> {
  const res = await fetch(`${TWILIO_TRUNKING}/Trunks/${trunkSid}`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, detail };
  }
  const data = (await res.json()) as Trunk;
  return { ok: true, trunk: data };
}

async function createTrunk(
  auth: string,
  friendlyName: string,
  domainSlug: string,
): Promise<
  | { ok: true; trunk: Trunk }
  | { ok: false; status: number; detail: string }
> {
  const desiredDomain = `${domainSlug}.pstn.twilio.com`;
  const res = await fetch(`${TWILIO_TRUNKING}/Trunks`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      FriendlyName: friendlyName,
      DomainName: desiredDomain,
    }).toString(),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: await res.text().catch(() => '') };
  }
  const data = (await res.json()) as Trunk;
  if (!data.sid || !data.domain_name) {
    return {
      ok: false,
      status: 502,
      detail: `Twilio returned no domain. ${JSON.stringify(data)}`,
    };
  }
  return { ok: true, trunk: data };
}

async function patchTrunkDomain(
  auth: string,
  trunkSid: string,
  domainSlug: string,
): Promise<{ ok: true; domain: string } | { ok: false; detail: string }> {
  const desiredDomain = `${domainSlug}.pstn.twilio.com`;
  const res = await fetch(`${TWILIO_TRUNKING}/Trunks/${trunkSid}`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ DomainName: desiredDomain }).toString(),
  });
  if (!res.ok) {
    return { ok: false, detail: await res.text().catch(() => '') };
  }
  const data = (await res.json()) as Trunk;
  if (!data.domain_name) {
    return { ok: false, detail: 'Twilio did not return a domain_name after patch' };
  }
  return { ok: true, domain: data.domain_name };
}

async function ensureRetellOriginationUri(
  auth: string,
  trunkSid: string,
): Promise<
  | { ok: true; note: string }
  | { ok: false; message: string; detail: string }
> {
  // List current origination URLs.
  const listRes = await fetch(
    `${TWILIO_TRUNKING}/Trunks/${trunkSid}/OriginationUrls`,
    { headers: { Authorization: auth } },
  );
  if (!listRes.ok) {
    return {
      ok: false,
      message: `Twilio origination URL list returned ${listRes.status}`,
      detail: await listRes.text().catch(() => ''),
    };
  }
  const data = (await listRes.json()) as {
    origination_urls?: Array<{ sip_url?: string; enabled?: boolean }>;
  };
  const has = (data.origination_urls ?? []).some(
    (u) => u.sip_url === RETELL_ORIGINATION_URI && u.enabled !== false,
  );
  if (has) {
    return { ok: true, note: 'already present' };
  }

  // Not present — add it.
  const addRes = await fetch(`${TWILIO_TRUNKING}/Trunks/${trunkSid}/OriginationUrls`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      FriendlyName: 'Retell',
      SipUrl: RETELL_ORIGINATION_URI,
      Priority: '10',
      Weight: '10',
      Enabled: 'true',
    }).toString(),
  });
  if (!addRes.ok) {
    return {
      ok: false,
      message: `Twilio origination URL create returned ${addRes.status}`,
      detail: await addRes.text().catch(() => ''),
    };
  }
  return { ok: true, note: 'added' };
}

async function importOrUpdateRetellNumber(args: {
  retellKey: string;
  retellBase: string;
  phone: string;
  trunkDomain: string;
  nickname: string;
  agentId: string;
}): Promise<
  | { ok: true; note: string }
  | { ok: false; message: string; detail: string }
> {
  const importRes = await fetch(`${args.retellBase}/import-phone-number`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.retellKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phone_number: args.phone,
      termination_uri: args.trunkDomain,
      nickname: args.nickname,
      inbound_agents: [{ agent_id: args.agentId, weight: 1 }],
    }),
  });

  if (importRes.ok) {
    return { ok: true, note: 'imported' };
  }

  const detail = await importRes.text().catch(() => '');

  // If the number is already imported, switch to update-phone-number which
  // patches the inbound_agents binding. Retell's wording varies across
  // versions ("already imported", "Phone number already exists.",
  // "phone_number_exists") so match loosely.
  const alreadyImported =
    importRes.status === 400 &&
    (/already.*import/i.test(detail) ||
      /phone[_ ]number.*(exists|imported)/i.test(detail) ||
      /already\s+exists/i.test(detail));

  if (!alreadyImported) {
    return {
      ok: false,
      message: `Retell import-phone-number returned ${importRes.status}`,
      detail,
    };
  }

  // Fall back to update.
  const updateRes = await fetch(
    `${args.retellBase}/update-phone-number/${encodeURIComponent(args.phone)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${args.retellKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nickname: args.nickname,
        inbound_agents: [{ agent_id: args.agentId, weight: 1 }],
      }),
    },
  );
  if (!updateRes.ok) {
    return {
      ok: false,
      message: `Retell update-phone-number returned ${updateRes.status}`,
      detail: await updateRes.text().catch(() => ''),
    };
  }
  return { ok: true, note: 'updated existing import' };
}

function fail(
  step: string,
  message: string,
  detail: string | undefined,
  log: StepLog[],
  extra: Record<string, string> = {},
): NextResponse {
  log.push({ step, ok: false, detail: detail?.slice(0, 500) });
  // Console-log on every failure so the dev terminal shows the upstream
  // provider's actual message, not just the 502 status.
  console.error(`[twilio/link] failed at ${step}: ${message}`, {
    detail: detail?.slice(0, 500),
    ...extra,
  });
  return NextResponse.json(
    {
      ok: false,
      failed_at: step,
      error: message,
      detail: detail?.slice(0, 500),
      log,
      ...extra,
    },
    { status: 502 },
  );
}
