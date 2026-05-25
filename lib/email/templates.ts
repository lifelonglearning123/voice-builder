// Email templates — minimal, inline-CSS, deliverability-safe.
//
// One shared template covers both signup and sign-in: the user clicks a
// branded button to be signed in. Per-agency branding is injected at send
// time (name + colour).

interface MagicLinkArgs {
  url: string;
  agencyName: string;
  brandColor?: string | null;
}

export function magicLinkSubject(agencyName: string): string {
  return `Sign in to ${agencyName}`;
}

export function magicLinkHtml({ url, agencyName, brandColor }: MagicLinkArgs): string {
  const accent = sanitizeHex(brandColor) ?? '#0f172a';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign in to ${escapeHtml(agencyName)}</title>
</head>
<body style="margin:0;padding:0;background:#fbfbfd;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fbfbfd;padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:36px;">
          <tr>
            <td style="font-size:13px;letter-spacing:0.18em;color:#94a3b8;text-transform:uppercase;font-weight:500;">
              ${escapeHtml(agencyName)}
            </td>
          </tr>
          <tr>
            <td style="padding-top:14px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:#0f172a;">
              Sign in to your account
            </td>
          </tr>
          <tr>
            <td style="padding-top:14px;font-size:15px;line-height:1.55;color:#475569;">
              Click the button below to sign in. The link is valid for one hour and can only be used once.
            </td>
          </tr>
          <tr>
            <td style="padding-top:28px;">
              <a href="${escapeAttr(url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:9999px;font-weight:500;font-size:15px;">
                Sign in &rarr;
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;font-size:12px;color:#94a3b8;line-height:1.55;">
              Or paste this URL into your browser:<br/>
              <a href="${escapeAttr(url)}" style="color:#64748b;word-break:break-all;">${escapeHtml(url)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding-top:28px;border-top:1px solid #f1f5f9;margin-top:24px;font-size:12px;color:#94a3b8;line-height:1.55;">
              If you didn&rsquo;t request this email, you can safely ignore it.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function magicLinkText({ url, agencyName }: MagicLinkArgs): string {
  return `Sign in to ${agencyName}

Click the link below to sign in. The link is valid for one hour and can only be used once.

${url}

If you didn't request this email, you can safely ignore it.`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
