// Usage: node --experimental-strip-types scripts/list-subscriptions.ts
//
// Dumps every bot that has a Stripe subscription on file, across every
// agency. For each row it prints:
//   - the agency the bot belongs to (name + slug)
//   - the owner's email (so a human-readable identifier)
//   - the Stripe sub status (from Stripe, not the cached DB column)
//   - the Connect destination on the Stripe sub, or "platform" when there
//     is none
//
// Use this to spot subscriptions that are being charged to the platform
// Stripe (Macaws) when they really belong to another agency — e.g. a
// customer who signed up on macaws.ai when they should have used Leonardo's
// branded domain. Those rows are migration candidates for the
// /api/admin/migrate-subscription route.
//
// Read-only.

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
    /* .env.local absent — fall back to process.env */
  }
}
loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!supabaseUrl || !serviceKey || !stripeKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or STRIPE_SECRET_KEY in .env.local',
  );
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const vb = createClient(supabaseUrl, serviceKey, {
  db: { schema: 'vb' },
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripe = new Stripe(stripeKey);

interface BotRow {
  id: string;
  agency_id: string;
  owner_user_id: string | null;
  client_stripe_subscription_id: string;
  client_subscription_status: string | null;
  draft: { business_name?: string } | null;
}

interface AgencyRow {
  id: string;
  name: string;
  slug: string;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarding_complete: boolean;
}

async function main() {
  const { data: bots, error: botsErr } = await vb
    .from('bots')
    .select(
      'id, agency_id, owner_user_id, client_stripe_subscription_id, client_subscription_status, draft',
    )
    .not('client_stripe_subscription_id', 'is', null);
  if (botsErr) {
    console.error('Failed to query bots:', botsErr.message);
    process.exit(1);
  }
  const botRows = (bots ?? []) as BotRow[];

  if (botRows.length === 0) {
    console.log('\nNo subscriptions on file across any agency.\n');
    return;
  }

  // Batch-load agencies and emails so we don't N+1 the obvious bits.
  const agencyIds = Array.from(new Set(botRows.map((b) => b.agency_id)));
  const userIds = Array.from(
    new Set(botRows.map((b) => b.owner_user_id).filter((v): v is string => !!v)),
  );

  const { data: agencyRows } = await vb
    .from('agencies')
    .select('id, name, slug, stripe_connect_account_id, stripe_connect_onboarding_complete')
    .in('id', agencyIds);
  const agencyById = new Map<string, AgencyRow>();
  for (const a of (agencyRows ?? []) as AgencyRow[]) agencyById.set(a.id, a);

  const emailEntries = await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        return [id, data.user?.email ?? null] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  const emailByUser = new Map(emailEntries);

  console.log(`\nFound ${botRows.length} subscription(s) across all agencies.\n`);

  let strandedCount = 0;
  for (const b of botRows) {
    const agency = agencyById.get(b.agency_id);
    const email = b.owner_user_id ? (emailByUser.get(b.owner_user_id) ?? '—') : '—';
    const businessName = b.draft?.business_name ?? '(no business name yet)';

    let stripeStatus = b.client_subscription_status ?? '—';
    let destination: string | null = null;
    let onBehalfOf: string | null = null;
    let liveStatus: string | null = null;
    try {
      const sub = await stripe.subscriptions.retrieve(b.client_stripe_subscription_id);
      liveStatus = sub.status;
      stripeStatus = sub.status;
      destination = sub.transfer_data?.destination
        ? typeof sub.transfer_data.destination === 'string'
          ? sub.transfer_data.destination
          : sub.transfer_data.destination.id
        : null;
      onBehalfOf =
        typeof sub.on_behalf_of === 'string'
          ? sub.on_behalf_of
          : (sub.on_behalf_of?.id ?? null);
    } catch (e) {
      stripeStatus = `(fetch failed: ${e instanceof Error ? e.message : String(e)})`;
    }

    const expectedDest = agency?.stripe_connect_account_id ?? null;
    const routedTo = destination ?? 'PLATFORM (Macaws)';
    const stranded =
      !!expectedDest && destination !== expectedDest && liveStatus !== 'canceled';
    if (stranded) strandedCount++;

    console.log(
      `Bot ${b.id}  ·  ${agency?.name ?? '(unknown agency)'} (${agency?.slug ?? '?'})`,
    );
    console.log(`  Owner email:        ${email}`);
    console.log(`  Business name:      ${businessName}`);
    console.log(`  Sub ID:             ${b.client_stripe_subscription_id}`);
    console.log(`  Stripe status:      ${stripeStatus}`);
    console.log(`  Routed to:          ${routedTo}`);
    console.log(`  on_behalf_of:       ${onBehalfOf ?? '— (none)'}`);
    console.log(`  Agency Connect:     ${expectedDest ?? '— (no Connect account)'}`);
    if (stranded) {
      console.log(
        `  ⚠ STRANDED — sub is being charged to the platform / wrong Connect account,
                  but this agency has its own Connect account configured.
                  Candidate for /api/admin/migrate-subscription.`,
      );
    }
    console.log('');
  }

  console.log(`Summary: ${strandedCount} stranded subscription(s) found.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
