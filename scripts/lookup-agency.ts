// Usage: node --experimental-strip-types scripts/lookup-agency.ts <slug>
//
// Diagnoses an agency's Stripe Connect state. Prints:
//   - the agency row from vb.agencies (relevant Connect columns)
//   - the live Stripe Account object (details_submitted, charges_enabled,
//     payouts_enabled, requirements) when an account id is present
//   - the bots in this agency whose checkouts have completed, so you can see
//     which subscriptions exist and whether they were routed via Connect
//
// Why this exists: when an agency reports "my client paid but I can't see
// the transaction in my Stripe", it's almost always one of:
//   (a) they never finished Connect onboarding — the agency row has
//       stripe_connect_onboarding_complete=false, so the platform charged
//       directly and money landed in the platform Stripe (Macaws).
//   (b) onboarding finished, but Stripe's account.updated webhook never
//       reached us, so the DB flag is still false even though the live
//       account is fine. This script catches that mismatch.
//
// Read-only. Safe to run in prod.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local not found — rely on existing process.env
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!stripeKey) {
  console.error('Missing STRIPE_SECRET_KEY in .env.local');
  process.exit(1);
}

const slug = process.argv[2]?.trim();
if (!slug) {
  console.error('Usage: node --experimental-strip-types scripts/lookup-agency.ts <slug>');
  process.exit(1);
}

const vb = createClient(supabaseUrl, serviceKey, {
  db: { schema: 'vb' },
  auth: { persistSession: false, autoRefreshToken: false },
});

const stripe = new Stripe(stripeKey);

async function main() {
  console.log(`\nLooking up agency: ${slug}\n`);

  const { data: agency, error } = await vb
    .from('agencies')
    .select(
      'id, name, slug, custom_domain, stripe_connect_account_id, stripe_connect_onboarding_complete, stripe_country, client_price_pence, client_currency',
    )
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    console.error('Failed to query agency:', error.message);
    process.exit(1);
  }
  if (!agency) {
    console.log(`No agency found with slug "${slug}".`);
    process.exit(0);
  }

  console.log('=== Agency Row ===');
  console.log(`  ID:                            ${agency.id}`);
  console.log(`  Name:                          ${agency.name}`);
  console.log(`  Slug:                          ${agency.slug}`);
  console.log(`  Custom domain:                 ${agency.custom_domain ?? '—'}`);
  console.log(`  Stripe country:                ${agency.stripe_country ?? '—'}`);
  console.log(`  Stripe Connect account ID:    ${agency.stripe_connect_account_id ?? '—'}`);
  console.log(`  Onboarding complete (DB):      ${agency.stripe_connect_onboarding_complete}`);
  console.log(`  Client price:                  ${agency.client_price_pence ?? '—'} ${agency.client_currency ?? ''}`);

  if (!agency.stripe_connect_account_id) {
    console.log(`\n  ⚠ No Connect account on this agency. All checkouts will charge the
    platform Stripe (Macaws), not this agency. The agency owner needs to
    visit /dashboard/settings and start Connect onboarding.\n`);
  } else {
    console.log('\n=== Live Stripe Account ===');
    try {
      const acct = await stripe.accounts.retrieve(agency.stripe_connect_account_id);
      console.log(`  ID:                  ${acct.id}`);
      console.log(`  Type:                ${acct.type}`);
      console.log(`  Country:             ${acct.country}`);
      console.log(`  details_submitted:   ${acct.details_submitted}`);
      console.log(`  charges_enabled:     ${acct.charges_enabled}`);
      console.log(`  payouts_enabled:     ${acct.payouts_enabled}`);
      const liveComplete = !!acct.details_submitted && !!acct.charges_enabled;
      console.log(`  Onboarding complete (live derived): ${liveComplete}`);
      if (liveComplete !== agency.stripe_connect_onboarding_complete) {
        console.log(
          `\n  ⚠ DB and Stripe disagree. The agency.updated webhook probably never
    fired (or failed). Run a manual sync (UPDATE vb.agencies SET
    stripe_connect_onboarding_complete = ${liveComplete} WHERE id = '${agency.id}')
    or have the agency owner re-visit /api/stripe/connect/return — both will
    bring the DB back in line.`,
        );
      }
      const req = acct.requirements;
      if (req && (req.currently_due?.length || req.past_due?.length)) {
        console.log('\n  Outstanding requirements (Stripe still wants):');
        if (req.currently_due?.length) console.log(`    currently_due: ${req.currently_due.join(', ')}`);
        if (req.past_due?.length) console.log(`    past_due:      ${req.past_due.join(', ')}`);
        if (req.disabled_reason) console.log(`    disabled_reason: ${req.disabled_reason}`);
      }
    } catch (e) {
      console.error(
        `  ⚠ Failed to retrieve Stripe account: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Show bots in this agency that have a subscription on file — useful for
  // seeing which checkouts have completed and which routing path they used.
  const { data: bots } = await vb
    .from('bots')
    .select(
      'id, status, owner_user_id, client_subscription_status, client_stripe_subscription_id, created_at',
    )
    .eq('agency_id', agency.id)
    .not('client_stripe_subscription_id', 'is', null)
    .order('created_at', { ascending: false });

  console.log(`\n=== Subscriptions in this agency: ${bots?.length ?? 0} ===`);
  if (!bots || bots.length === 0) {
    console.log('  (none)');
  } else {
    for (const b of bots) {
      console.log(`\n  Bot ${b.id}`);
      console.log(`    Bot status:        ${b.status}`);
      console.log(`    Sub status (DB):   ${b.client_subscription_status ?? '—'}`);
      console.log(`    Stripe sub ID:     ${b.client_stripe_subscription_id}`);

      if (b.client_stripe_subscription_id) {
        try {
          const sub = await stripe.subscriptions.retrieve(b.client_stripe_subscription_id, {
            expand: ['latest_invoice'],
          });
          const routedTo = sub.transfer_data?.destination ?? null;
          console.log(`    Routed to Connect: ${routedTo ?? '— (platform / Macaws)'}`);
          if (
            routedTo &&
            agency.stripe_connect_account_id &&
            routedTo !== agency.stripe_connect_account_id
          ) {
            console.log(
              `    ⚠ Routed to a different Connect account than this agency's. Investigate.`,
            );
          }
        } catch (e) {
          console.log(
            `    Failed to fetch subscription: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
