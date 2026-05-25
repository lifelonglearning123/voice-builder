import { Resend } from 'resend';

// Single Resend client for the whole process. Macaws' Resend account; agencies
// share it but use different verified sender domains (configured per-agency
// via vb.agencies.from_email).

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
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
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
