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
}

export async function sendEmailViaGhl(
  config: GhlConfig,
  args: GhlSendArgs,
): Promise<void> {
  const contactId = await upsertContact(config, args.to);
  await sendMessage(config, contactId, args);
}

async function upsertContact(config: GhlConfig, email: string): Promise<string> {
  const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: ghlHeaders(config.apiToken),
    body: JSON.stringify({
      locationId: config.locationId,
      email,
    }),
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
