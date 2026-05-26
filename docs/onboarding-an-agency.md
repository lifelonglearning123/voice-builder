# Onboarding a new agency

The platform supports multiple white-label agencies sharing a single
Supabase project + Resend account + Stripe Connect platform. This doc is
the runbook for adding agency #2, #3, … etc.

Macaws is agency #1 (the platform owner). The steps below are what you do
each time a new agency signs on.

---

## 1. Collect the basics from the agency

Get from the agency owner:

- **Agency name** (display + Stripe receipts) — e.g. *Acme Digital*
- **Slug** for the URL — short, alphanumeric — e.g. `acme`
- **Custom domain** they'll point to us — e.g. `voice-builder.acmedigital.com`
- **Owner email** — the email the agency owner will sign in with
- **Sender email** — what magic-link emails should come from — e.g. `noreply@acmedigital.com`
- **Sender display name** — e.g. `Acme Digital`

---

## 2. Verify their sender domain in Resend

The agency's `from_email` (e.g. `noreply@acmedigital.com`) needs the domain
verified in **Macaws's Resend account**. Macaws's Resend can have many
verified domains; the agency doesn't need a Resend account of their own.

1. Resend Dashboard → **Domains** → **Add Domain** → enter `acmedigital.com`
2. Resend shows 3 DNS records (SPF, DKIM, DMARC).
3. **Send the records to the agency** — they add them to their DNS host
   (Cloudflare / Namecheap / GoDaddy / etc.). Typical DNS records:

   | Type | Name (on `acmedigital.com`) | Value |
   |---|---|---|
   | MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | (long DKIM public key) |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` |

4. Once DNS propagates (~5 min), back in Resend click **Verify**. Status
   flips to **Verified**.

---

## 3. Point the agency's custom domain at Vercel

The agency picks a subdomain on their own domain — e.g.
`voice-builder.acmedigital.com`. They add ONE CNAME record:

| Type | Name | Value |
|---|---|---|
| CNAME | `voice-builder` | `cname.vercel-dns.com` |

In **Vercel project → Settings → Domains → Add Domain**, add
`voice-builder.acmedigital.com`. Vercel verifies + provisions SSL
automatically (~2 min).

## 3b. Add the agency's domain to Supabase Redirect URLs

Supabase rejects any auth redirect URL that isn't on its allowlist. Without
this step, magic-link emails for the new agency's SMBs will silently fall
back to the platform Site URL — breaking the white-label illusion.

- Supabase Dashboard → your project → **Authentication → URL Configuration**
- **Redirect URLs** → click **Add URL**
- Paste: `https://voice-builder.acmedigital.com/**`  *(the `/**` wildcard lets the `?next=…&agency=…` query string variations through)*
- **Save**

Site URL stays unchanged — it's the platform's default and shared across all
agencies. Only the Redirect URLs list grows as agencies join.

---

## 4. Insert the agency row + owner membership

After the agency owner has signed in at least once (so a row exists in
`auth.users`), run in Supabase SQL Editor:

```sql
-- 4a. Create the agency
INSERT INTO vb.agencies (
  name,
  slug,
  custom_domain,
  custom_domain_verified,
  from_email,
  from_name,
  brand_color
)
VALUES (
  'Acme Digital',                           -- agency name
  'acme',                                   -- slug
  'voice-builder.acmedigital.com',          -- custom domain
  true,                                     -- flip once Vercel + DNS confirm
  'noreply@acmedigital.com',                -- from_email
  'Acme Digital',                           -- from_name
  '#0071e3'                                 -- brand colour (hex; optional)
)
ON CONFLICT (slug) DO NOTHING;

-- 4b. Add the owner as agency_member
INSERT INTO vb.agency_members (agency_id, user_id, role)
SELECT
  (SELECT id FROM vb.agencies WHERE slug = 'acme'),
  (SELECT id FROM auth.users WHERE email = 'owner@acmedigital.com'),
  'owner'
ON CONFLICT (agency_id, user_id) DO NOTHING;
```

Adjust the values per the agency you're onboarding.

---

## 5. Tell the owner to complete Stripe Connect onboarding

The agency can't accept payments from SMBs until they've finished Stripe
Connect Express onboarding. Send them this URL:

```
https://voice-builder.acmedigital.com/dashboard/settings
```

(or whatever their custom domain is). They:

1. Sign in via magic link
2. Click the **Settings** link in the dashboard header
3. Click **Set up payments**
4. Walk through Stripe's hosted Connect Express onboarding (KYC, bank,
   ID verification — Stripe handles all of this)
5. Land back on the settings page with green **"Connected"** status

Once onboarded, their `vb.agencies.stripe_connect_account_id` is set and
`stripe_connect_onboarding_complete = true`. SMB subscriptions from that
agency will route payments to their Connect account.

**Macaws doesn't see their bank details, customer cards, or revenue
numbers** — Stripe holds all of it. Macaws's only revenue from this
agency is the flat monthly platform subscription (out of scope of this
codebase for now — billed manually).

---

## 6. Quick smoke test

To confirm the agency is wired correctly, do an end-to-end:

1. Open an incognito window → `https://voice-builder.acmedigital.com/signup`
2. Sign up with a fresh test email
3. After magic-link sign-in, you should land on `/dashboard` in **client
   view** with *"You're signed in via Acme Digital"*
4. The signup email itself should come from `Acme Digital <noreply@acmedigital.com>`

If any of those are wrong, paste the failing step back to the engineering
team — most issues are DNS propagation (give it longer) or a typo in the
`vb.agencies` row.

---

## Removing an agency

To deactivate an agency without dropping its data:

```sql
UPDATE vb.agencies
   SET custom_domain_verified = false,
       stripe_connect_onboarding_complete = false
 WHERE slug = 'acme';
```

That blocks new sign-ups (`resolveAgency` requires verification) and stops
new SMB payments from routing to their Connect account. Existing SMBs of
that agency keep working until their subscriptions naturally end.

To **hard-delete**:

```sql
DELETE FROM vb.agencies WHERE slug = 'acme';
```

Cascades to `vb.agency_members`, `vb.agency_clients`, and `vb.bots`. There
is no undo — Retell agents and Twilio numbers don't get torn down by the
DB cascade, so do that manually in their respective dashboards first if
you want a clean wipe.
