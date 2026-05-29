import { Resend } from 'resend';
import { sendEmailViaGhl, type GhlConfig } from './ghl';

// Transactional email transport.
//
// GHL (GoHighLevel) is the primary transport. Resolution order:
//   1. Per-agency config on the agency row (ghl_location_id + ghl_api_token)
//   2. Platform-wide env vars GHL_LOCATION_ID + GHL_API_TOKEN (quick setup
//      for single-tenant / default-agency deployments)
//   3. Resend fallback — used when neither GHL config is present, or when
//      a GHL send threw (network blip, expired token). Logged loudly so
//      misconfiguration doesn't get silently masked.

let cached: Resend | null = null;

function getResend(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not set on the server.');
  }
  cached = new Resend(key);
  return cached;
}

export interface SendEmailArgs {
  to: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
  /** When set, attempt GHL delivery first; fall through to Resend on failure. */
  ghl?: GhlConfig | null;
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const ghl = args.ghl ?? envGhlConfig();
  if (ghl?.locationId && ghl?.apiToken) {
    try {
      await sendEmailViaGhl(ghl, {
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        fromEmail: args.fromEmail,
        fromName: args.fromName,
      });
      return;
    } catch (e) {
      console.error('[email] GHL send failed, falling back to Resend:', e);
      // Fall through to Resend.
    }
  }

  // Resend fallback (or primary, when GHL isn't configured at all).
  await sendViaResend(args);
}

function envGhlConfig(): GhlConfig | null {
  const locationId = process.env.GHL_LOCATION_ID;
  const apiToken = process.env.GHL_API_TOKEN;
  if (!locationId || !apiToken) return null;
  return { locationId, apiToken };
}

async function sendViaResend(args: SendEmailArgs): Promise<void> {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: `${args.fromName} <${args.fromEmail}>`,
    to: [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
  if (error) {
    // Resend errors include `name` and `message`. Log the full thing
    // server-side but never let the provider name leak into a thrown
    // error message that might bubble to the user.
    console.error('[email] resend send failed:', error);
    throw new Error('Email could not be sent');
  }
  if (!data?.id) {
    console.error('[email] resend returned no id, data:', data);
    throw new Error('Email could not be sent');
  }
}
