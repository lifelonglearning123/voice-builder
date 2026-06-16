// GoHighLevel (LeadConnector v2) transactional-email transport.
//
// Each white-label agency stores their own location_id + Private Integration
// Token on vb.agencies. When set, transactional emails route through GHL
// instead of Resend so the message lands in the agency's CRM and ships from
// their verified sending domain — naturally per-agency branded.
//
// Two-step send:
//   1. Upsert the recipient as a contact in the agency's GHL location.
//   2. Send an email message via the Conversations API attached to that
//      contact.
//
// The Conversations endpoint returns immediately once GHL has accepted the
// message for delivery (similar to Resend).

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export interface GhlConfig {
  locationId: string;
  apiToken: string;
}

export interface GhlSendArgs {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative — passed through where the API supports it. */
  text?: string;
  /** "Acme <noreply@acme.com>" or "noreply@acme.com". Falls back to the
   *  location's default sending identity when omitted. */
  fromEmail?: string;
  fromName?: string;
  /** Optional contact profile fields. When provided, written to the GHL
   *  contact during the upsert so the contact card has more than an email
   *  on it. Safe to omit — GHL keeps any existing values if we don't send
   *  the field, so subsequent email-only sends won't wipe a name/phone
   *  populated by an earlier signup. */
  contactName?: string;
  contactPhone?: string;
}

export async function sendEmailViaGhl(
  config: GhlConfig,
  args: GhlSendArgs,
): Promise<void> {
  const contactId = await upsertContact(config, {
    email: args.to,
    name: args.contactName,
    phone: args.contactPhone,
  });
  await sendMessage(config, contactId, args);
}

interface UpsertContactArgs {
  email: string;
  name?: string;
  phone?: string;
}

// Tag stamped on every contact we touch — lets agencies filter / segment
// Voice Builder leads inside GHL without having to guess from the contact's
// source field. GHL merges tags on upsert (additive), so re-sending it on
// later emails to the same contact is a no-op rather than a duplicate.
const VOICE_BUILDER_TAG = 'voice-builder';

async function upsertContact(
  config: GhlConfig,
  args: UpsertContactArgs,
): Promise<string> {
  const payload: Record<string, unknown> = {
    locationId: config.locationId,
    email: args.email,
    tags: [VOICE_BUILDER_TAG],
  };
  if (args.name?.trim()) {
    const { firstName, lastName } = splitName(args.name);
    payload.name = args.name.trim();
    if (firstName) payload.firstName = firstName;
    if (lastName) payload.lastName = lastName;
  }
  if (args.phone?.trim()) {
    payload.phone = args.phone.trim();
  }

  const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: ghlHeaders(config.apiToken),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `GHL upsert contact failed: ${res.status} ${text.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    contact?: { id?: string };
    id?: string;
  };
  const id = data.contact?.id ?? data.id;
  if (!id) {
    throw new Error('GHL upsert contact returned no id');
  }
  return id;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function sendMessage(
  config: GhlConfig,
  contactId: string,
  args: GhlSendArgs,
): Promise<void> {
  const from = formatFrom(args.fromName, args.fromEmail);
  const body: Record<string, unknown> = {
    type: 'Email',
    contactId,
    subject: args.subject,
    html: args.html,
  };
  if (args.text) body.message = args.text;
  if (from) body.emailFrom = from;

  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(config.apiToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `GHL send message failed: ${res.status} ${text.slice(0, 300)}`,
    );
  }
}

function formatFrom(name?: string, email?: string): string | undefined {
  if (!email) return undefined;
  if (name) return `${name} <${email}>`;
  return email;
}

function ghlHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}
