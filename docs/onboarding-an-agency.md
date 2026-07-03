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
- **Country of business** (ISO-3166 alpha-2, e.g. `GB`, `US`, `CA`) — where
  the agency is registered and banks. Stripe Connect Express locks the
  country at account creation, so the owner needs to pick this *before*
  clicking *Set up payments*. The settings page exposes a dropdown but they
  can also pre-set it in the agency row below.

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

## 4a. Insert the agency row (do this FIRST, before anyone signs in)

The agency row must exist **before** the owner or any client visits the
custom domain — `resolveAgency` (`lib/agency/resolve.ts`) matches the
incoming Host against `vb.agencies.custom_domain` AND
`custom_domain_verified = true`. Without that row, every signup attempt
returns:

> *We couldn't identify which workspace you're signing in to. Please contact support.*

Run in Supabase SQL Editor:

```sql
INSERT INTO vb.agencies (
  name,
  slug,
  custom_domain,
  custom_domain_verified,
  from_email,
  from_name,
  brand_color,
  stripe_country
)
VALUES (
  'Acme Digital',                           -- agency name
  'acme',                                   -- slug
  'voice-builder.acmedigital.com',          -- custom domain (exact host the client will visit — no scheme, no path)
  true,                                     -- ⚠ THIS IS THE GATE. Must be true or signup fails silently.
  'noreply@acmedigital.com',                -- from_email (domain must be verified in Resend — see step 2)
  'Acme Digital',                           -- from_name (shown as sender label)
  '#0071e3',                                -- brand colour (hex; optional)
  'GB'                                      -- ISO-3166 alpha-2; locks Stripe Connect country
)
ON CONFLICT (slug) DO NOTHING;
```

> **About `custom_domain_verified`:** despite the name, *nothing in the
> code verifies DNS or SSL*. It's a pure manual on/off switch for the
> operator. The column defaults to `false`, so if you omit it from the
> INSERT, the agency is dead-on-arrival. Set it to `true` here. The only
> reason to set it `false` is to deactivate an existing agency (see
> *Removing an agency* below).

## 4b. Promote the owner once they've signed in

Now tell the owner to hit `https://<their-custom-domain>/signup` and
complete the magic-link flow. That creates their row in `auth.users` and
auto-provisions them as a *client* of the agency. To upgrade them to
*owner*:

```sql
INSERT INTO vb.agency_members (agency_id, user_id, role)
SELECT
  (SELECT id FROM vb.agencies WHERE slug = 'acme'),
  (SELECT id FROM auth.users  WHERE email = 'owner@acmedigital.com'),
  'owner'
ON CONFLICT (agency_id, user_id) DO UPDATE SET role = EXCLUDED.role;
```

(The `DO UPDATE` overrides the auto-provisioned client membership.)

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
3. Confirm the **country** dropdown matches their registered business —
   Stripe locks this at account creation and there's no way to change it
   later without abandoning the account
4. Click **Set up payments**
5. Walk through Stripe's hosted Connect Express onboarding (KYC, bank,
   ID verification — Stripe handles all of this)
6. Land back on the settings page with green **"Connected"** status

> If an owner already started Stripe onboarding under the wrong country (the
> hardcoded GB default before migration 008), the fix is to clear both
> `stripe_connect_account_id` and `stripe_connect_onboarding_complete` on
> their `vb.agencies` row, set `stripe_country` to the correct value, and
> have them click **Set up payments** again. The orphaned GB account in
> Stripe is harmless — archive it manually in the Connect dashboard.

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

## Diagnosing "We couldn't identify which workspace…" errors

This error fires from `app/api/auth/send-magic-link/route.ts` whenever
`resolveAgency` returns null. Run the diagnostic script against the
*exact* URL the client tried:

```bash
node --use-system-ca --experimental-strip-types \
  scripts/diagnose-agency-host.ts https://voice-builder.acmedigital.com
```

It replays the three resolution branches (verified host match → query
slug → `DEFAULT_AGENCY_SLUG` env fallback) and prints which one would
have matched, plus near-miss rows for typos (apex vs `www`, subdomain
mismatch, wrong TLD). It also warns if a row resolves but `from_email`
or `from_name` is null, because that triggers the *next* error
(*"Sign-in email isn't configured for this workspace yet"*).

Most common causes in order of frequency:

1. The agency row was inserted with `custom_domain_verified = false`
   (or the column was omitted, defaulting to false). Fix:
   `UPDATE vb.agencies SET custom_domain_verified = true WHERE slug = '<slug>';`
2. The `custom_domain` value doesn't exactly match the host the client
   typed (e.g. row stores apex but client visits `www.`, or vice versa).
3. The row was never inserted — step 4a was skipped.

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
