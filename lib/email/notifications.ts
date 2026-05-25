// Per-agency-branded transactional emails for milestones in the SMB lifecycle.
//
// Two so far:
//   1. Welcome — sent after first successful bot activation
//   2. Payment failed — sent when a renewal charge fails
//
// Both use the agency's `from_email` + `from_name` + `brand_color` from
// vb.agencies, so they feel native to the agency's brand rather than the
// platform.

import { sendEmail } from './send';

interface AgencyBrand {
  from_email: string;
  from_name: string;
  brand_color?: string | null;
}

interface WelcomeArgs {
  to: string;
  agency: AgencyBrand;
  businessName: string;
  phoneE164: string | null;
}

export async function sendWelcomeEmail(args: WelcomeArgs): Promise<void> {
  await sendEmail({
    to: args.to,
    fromEmail: args.agency.from_email,
    fromName: args.agency.from_name,
    subject: `Your AI receptionist is live`,
    html: welcomeHtml(args),
    text: welcomeText(args),
  });
}

interface PaymentFailedArgs {
  to: string;
  agency: AgencyBrand;
  businessName: string;
  manageBillingUrl: string;
}

export async function sendPaymentFailedEmail(args: PaymentFailedArgs): Promise<void> {
  await sendEmail({
    to: args.to,
    fromEmail: args.agency.from_email,
    fromName: args.agency.from_name,
    subject: `Action needed: payment failed for ${args.businessName}`,
    html: paymentFailedHtml(args),
    text: paymentFailedText(args),
  });
}

/* ---------------------------------------------------------------------------
 * Templates
 * ------------------------------------------------------------------------- */

function welcomeHtml({ agency, businessName, phoneE164 }: WelcomeArgs): string {
  const accent = sanitizeHex(agency.brand_color) ?? '#0f172a';
  const callLine = phoneE164
    ? `<p style="margin-top:18px;font-size:15px;line-height:1.55;color:#0f172a;"><strong>Test it now:</strong> call <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(phoneE164)}</span>.</p>`
    : '';
  return wrapHtml(
    `<div style="font-size:13px;letter-spacing:0.18em;color:#94a3b8;text-transform:uppercase;font-weight:500;">${escapeHtml(agency.from_name)}</div>
     <div style="padding-top:14px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:${accent};">${escapeHtml(businessName)} is live.</div>
     <div style="padding-top:14px;font-size:15px;line-height:1.55;color:#475569;">Your AI receptionist is taking calls right now. A summary lands in your inbox after every call.</div>
     ${callLine}
     <div style="padding-top:24px;font-size:12px;color:#94a3b8;line-height:1.55;">If you have any questions, just reply to this email.</div>`,
  );
}

function welcomeText({ agency, businessName, phoneE164 }: WelcomeArgs): string {
  const callLine = phoneE164 ? `\n\nTest it now: call ${phoneE164}.` : '';
  return `${businessName} is live.\n\nYour AI receptionist is taking calls right now. A summary lands in your inbox after every call.${callLine}\n\nIf you have any questions, just reply to this email.\n\n— ${agency.from_name}`;
}

function paymentFailedHtml({ agency, businessName, manageBillingUrl }: PaymentFailedArgs): string {
  const accent = sanitizeHex(agency.brand_color) ?? '#0f172a';
  return wrapHtml(
    `<div style="font-size:13px;letter-spacing:0.18em;color:#94a3b8;text-transform:uppercase;font-weight:500;">${escapeHtml(agency.from_name)}</div>
     <div style="padding-top:14px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:${accent};">Payment didn&rsquo;t go through</div>
     <div style="padding-top:14px;font-size:15px;line-height:1.55;color:#475569;">We couldn&rsquo;t take this month&rsquo;s payment for <strong style="color:#0f172a;">${escapeHtml(businessName)}</strong>. To keep your AI receptionist taking calls, please update your card.</div>
     <div style="padding-top:28px;"><a href="${escapeAttr(manageBillingUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:9999px;font-weight:500;font-size:15px;">Update card &rarr;</a></div>
     <div style="padding-top:24px;font-size:12px;color:#94a3b8;line-height:1.55;">We&rsquo;ll keep your receptionist running for a few days while you fix this. After that it&rsquo;ll pause until payment goes through.</div>`,
  );
}

function paymentFailedText({ agency, businessName, manageBillingUrl }: PaymentFailedArgs): string {
  return `Payment didn't go through\n\nWe couldn't take this month's payment for ${businessName}. To keep your AI receptionist taking calls, please update your card:\n\n${manageBillingUrl}\n\nWe'll keep your receptionist running for a few days while you fix this. After that it'll pause until payment goes through.\n\n— ${agency.from_name}`;
}

function wrapHtml(body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#fbfbfd;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fbfbfd;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:36px;">
        <tr><td>${body}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function sanitizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) return trimmed;
  return null;
}
