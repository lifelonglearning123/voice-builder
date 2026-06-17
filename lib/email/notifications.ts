// Per-agency-branded transactional emails for milestones in the SMB lifecycle.
//
// Four so far:
//   1. Welcome — sent to the SMB after first successful bot activation
//   2. Payment failed — sent to the SMB when a renewal charge fails
//   3. Client went live (agency notification) — sent to agency owners/admins
//      so they can hand the client over to Voice Monitor
//   4. Drop-off recovery — sent at 24h / 72h / 7d to SMBs who started the
//      wizard but never activated their bot
//
// All use the agency's `from_email` + `from_name` + `brand_color` from
// vb.agencies, so they feel native to the agency's brand rather than the
// platform.

import { sendEmail } from './send';

interface AgencyBrand {
  from_email: string;
  from_name: string;
  brand_color?: string | null;
  /** Optional GHL Private Integration Token + location. When both are set,
   *  sendEmail routes through GHL first and falls back to Resend on failure. */
  ghl_location_id?: string | null;
  ghl_api_token?: string | null;
}

function ghlConfig(agency: AgencyBrand) {
  if (agency.ghl_location_id && agency.ghl_api_token) {
    return { locationId: agency.ghl_location_id, apiToken: agency.ghl_api_token };
  }
  return null;
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
    ghl: ghlConfig(args.agency),
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
    ghl: ghlConfig(args.agency),
  });
}

interface AgencyClientWentLiveArgs {
  to: string;
  agency: AgencyBrand;
  /** SMB business display name. */
  businessName: string;
  /** SMB owner's email (so the agency can reach out directly). */
  clientEmail: string;
  /** SMB receptionist phone number, if linked. */
  phoneE164: string | null;
  /** Deep link into the agency dashboard's clients view. */
  dashboardUrl: string;
}

export async function sendAgencyClientWentLiveEmail(args: AgencyClientWentLiveArgs): Promise<void> {
  await sendEmail({
    to: args.to,
    fromEmail: args.agency.from_email,
    fromName: args.agency.from_name,
    subject: `Action needed: ${args.businessName} just went live — Voice Monitor handoff pending`,
    html: agencyClientWentLiveHtml(args),
    text: agencyClientWentLiveText(args),
    ghl: ghlConfig(args.agency),
  });
}

export type DropOffStage = '24h' | '72h' | '7d';

interface DropOffArgs {
  to: string;
  agency: AgencyBrand;
  stage: DropOffStage;
  /** SMB business name if they typed one, otherwise null — we soften the
   *  copy if we don't know what to call them yet. */
  businessName: string | null;
  /** Deep link back into the wizard, ideally /bots/new?bot=<id>. */
  resumeUrl: string;
}

export async function sendDropOffEmail(args: DropOffArgs): Promise<void> {
  const subject = dropOffSubject(args.stage, args.businessName);
  await sendEmail({
    to: args.to,
    fromEmail: args.agency.from_email,
    fromName: args.agency.from_name,
    subject,
    html: dropOffHtml(args),
    text: dropOffText(args),
    ghl: ghlConfig(args.agency),
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
  const voiceMonitorLine = `<p style="margin-top:18px;font-size:15px;line-height:1.55;color:#475569;"><strong style="color:#0f172a;">What happens next:</strong> ${escapeHtml(agency.from_name)} will be in touch within one business day to give you access to <strong style="color:#0f172a;">Voice Monitor</strong> &mdash; where you&rsquo;ll see every call and improve your AI receptionist over time.</p>`;
  return wrapHtml(
    `<div style="font-size:13px;letter-spacing:0.18em;color:#94a3b8;text-transform:uppercase;font-weight:500;">${escapeHtml(agency.from_name)}</div>
     <div style="padding-top:14px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:${accent};">${escapeHtml(businessName)} is live.</div>
     <div style="padding-top:14px;font-size:15px;line-height:1.55;color:#475569;">Your AI receptionist is taking calls right now. A summary lands in your inbox after every call.</div>
     ${callLine}
     ${voiceMonitorLine}
     <div style="padding-top:24px;font-size:12px;color:#94a3b8;line-height:1.55;">If you have any questions, just reply to this email.</div>`,
  );
}

function welcomeText({ agency, businessName, phoneE164 }: WelcomeArgs): string {
  const callLine = phoneE164 ? `\n\nTest it now: call ${phoneE164}.` : '';
  const voiceMonitorLine = `\n\nWhat happens next: ${agency.from_name} will be in touch within one business day to give you access to Voice Monitor — where you'll see every call and improve your AI receptionist over time.`;
  return `${businessName} is live.\n\nYour AI receptionist is taking calls right now. A summary lands in your inbox after every call.${callLine}${voiceMonitorLine}\n\nIf you have any questions, just reply to this email.\n\n— ${agency.from_name}`;
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

function agencyClientWentLiveHtml({ agency, businessName, clientEmail, phoneE164, dashboardUrl }: AgencyClientWentLiveArgs): string {
  const accent = sanitizeHex(agency.brand_color) ?? '#0f172a';
  const phoneRow = phoneE164
    ? `<tr><td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;">Receptionist number</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(phoneE164)}</td></tr>`
    : '';
  return wrapHtml(
    `<div style="font-size:13px;letter-spacing:0.18em;color:#94a3b8;text-transform:uppercase;font-weight:500;">Action needed</div>
     <div style="padding-top:14px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:${accent};">${escapeHtml(businessName)} just went live.</div>
     <div style="padding-top:14px;font-size:15px;line-height:1.55;color:#475569;">Reach out within one business day to hand them over to <strong style="color:#0f172a;">Voice Monitor</strong>, so they can see every call and refine the AI receptionist over time.</div>
     <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;width:100%;border-top:1px solid #e2e8f0;">
       <tr><td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;">Client</td><td style="padding:8px 0;color:#0f172a;font-size:14px;">${escapeHtml(businessName)}</td></tr>
       <tr><td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;">Contact</td><td style="padding:8px 0;color:#0f172a;font-size:14px;"><a href="mailto:${escapeAttr(clientEmail)}" style="color:#0f172a;text-decoration:underline;">${escapeHtml(clientEmail)}</a></td></tr>
       ${phoneRow}
     </table>
     <div style="padding-top:28px;"><a href="${escapeAttr(dashboardUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:9999px;font-weight:500;font-size:15px;">Open dashboard &rarr;</a></div>
     <div style="padding-top:24px;font-size:12px;color:#94a3b8;line-height:1.55;">You&rsquo;re receiving this because you&rsquo;re an owner or admin of ${escapeHtml(agency.from_name)}.</div>`,
  );
}

function agencyClientWentLiveText({ agency, businessName, clientEmail, phoneE164, dashboardUrl }: AgencyClientWentLiveArgs): string {
  const phoneLine = phoneE164 ? `\nReceptionist number: ${phoneE164}` : '';
  return `Action needed\n\n${businessName} just went live.\n\nReach out within one business day to hand them over to Voice Monitor, so they can see every call and refine the AI receptionist over time.\n\nClient: ${businessName}\nContact: ${clientEmail}${phoneLine}\n\nOpen dashboard: ${dashboardUrl}\n\nYou're receiving this because you're an owner or admin of ${agency.from_name}.`;
}

/* ---------- Drop-off recovery templates -------------------------------- */

function dropOffSubject(stage: DropOffStage, businessName: string | null): string {
  const name = businessName?.trim();
  switch (stage) {
    case '24h':
      return name
        ? `Pick up where you left off with ${name}`
        : `Your AI receptionist is half-built`;
    case '72h':
      return name
        ? `${name}'s receptionist is still waiting`
        : `Finish setting up your AI receptionist`;
    case '7d':
      return name
        ? `One last nudge — ${name} is ready to go live`
        : `One last nudge — finish your AI receptionist`;
  }
}

function dropOffCopy(stage: DropOffStage, businessName: string | null) {
  const subject = businessName?.trim() || 'Your AI receptionist';
  switch (stage) {
    case '24h':
      return {
        eyebrow: 'You started something good',
        headline: `${subject} is half-built.`,
        body: `You started setting up your AI receptionist yesterday. Everything you entered is saved — pick up exactly where you left off and you'll be live in a few more minutes.`,
        cta: 'Continue building',
      };
    case '72h':
      return {
        eyebrow: 'Still here when you are',
        headline: `${subject} is waiting for you.`,
        body: `Your draft is still saved. Most businesses finish setup in about 10 minutes — and once you're live, your receptionist starts answering every call, day or night.`,
        cta: 'Finish setup',
      };
    case '7d':
      return {
        eyebrow: 'One last nudge',
        headline: `Ready to bring ${subject} live?`,
        body: `Your draft is still here, ready when you are. If now isn't the right time we won't email again — but if you'd like to finish, it's about 10 minutes from where you left off.`,
        cta: 'Pick up where I left off',
      };
  }
}

function dropOffHtml(args: DropOffArgs): string {
  const accent = sanitizeHex(args.agency.brand_color) ?? '#0f172a';
  const copy = dropOffCopy(args.stage, args.businessName);
  return wrapHtml(
    `<div style="font-size:13px;letter-spacing:0.18em;color:#94a3b8;text-transform:uppercase;font-weight:500;">${escapeHtml(args.agency.from_name)}</div>
     <div style="padding-top:14px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:${accent};">${escapeHtml(copy.headline)}</div>
     <div style="padding-top:14px;font-size:15px;line-height:1.55;color:#475569;">${escapeHtml(copy.body)}</div>
     <div style="padding-top:28px;"><a href="${escapeAttr(args.resumeUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:9999px;font-weight:500;font-size:15px;">${escapeHtml(copy.cta)} &rarr;</a></div>
     <div style="padding-top:24px;font-size:12px;color:#94a3b8;line-height:1.55;">If you'd rather not hear from us again, just reply with the word &ldquo;unsubscribe&rdquo; and we'll stop.</div>`,
  );
}

function dropOffText(args: DropOffArgs): string {
  const copy = dropOffCopy(args.stage, args.businessName);
  return `${copy.headline}\n\n${copy.body}\n\n${copy.cta}: ${args.resumeUrl}\n\nIf you'd rather not hear from us again, just reply with the word "unsubscribe" and we'll stop.\n\n— ${args.agency.from_name}`;
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
