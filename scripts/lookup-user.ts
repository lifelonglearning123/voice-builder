// Usage: node --experimental-strip-types scripts/lookup-user.ts <email>
// Looks up a user by email and prints their agency memberships, client links, and bots.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Load .env.local manually (no dotenv dep required)
// ---------------------------------------------------------------------------
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const email = process.argv[2]?.trim();
if (!email) {
  console.error('Usage: node --experimental-strip-types scripts/lookup-user.ts <email>');
  process.exit(1);
}

// Service-role client — bypasses RLS, targets public schema for auth queries
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// vb-schema client for vb.* tables
const vb = createClient(url, serviceKey, {
  db: { schema: 'vb' },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(`\nLooking up: ${email}\n`);

  // 1. Find auth user by email
  const { data: listData, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) {
    console.error('Failed to list users:', listErr.message);
    process.exit(1);
  }
  const user = listData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.log('No auth user found with that email.');
    process.exit(0);
  }

  console.log('=== Auth User ===');
  console.log(`  ID:           ${user.id}`);
  console.log(`  Email:        ${user.email}`);
  console.log(`  Created:      ${user.created_at}`);
  console.log(`  Last sign-in: ${user.last_sign_in_at ?? 'never'}`);
  console.log(`  Confirmed:    ${user.email_confirmed_at ? 'yes' : 'no'}`);

  // 2. Agency memberships (staff/owner/admin)
  const { data: members, error: membersErr } = await vb
    .from('agency_members')
    .select('agency_id, role, created_at, agencies(id, name, slug, custom_domain, platform_subscription_status)')
    .eq('user_id', user.id);

  if (membersErr) {
    console.error('\nFailed to fetch agency_members:', membersErr.message);
  } else if (members && members.length > 0) {
    console.log('\n=== Agency Staff/Owner Memberships ===');
    for (const m of members) {
      const a = m.agencies as Record<string, unknown> | null;
      console.log(`  Role: ${m.role}`);
      console.log(`    Agency ID:     ${m.agency_id}`);
      console.log(`    Name:          ${a?.name ?? '—'}`);
      console.log(`    Slug:          ${a?.slug ?? '—'}`);
      console.log(`    Domain:        ${a?.custom_domain ?? '—'}`);
      console.log(`    Sub status:    ${a?.platform_subscription_status ?? '—'}`);
      console.log(`    Member since:  ${m.created_at}`);
    }
  } else {
    console.log('\n  No agency staff memberships.');
  }

  // 3. Agency client links
  const { data: clients, error: clientsErr } = await vb
    .from('agency_clients')
    .select('agency_id, created_at, agencies(id, name, slug, custom_domain)')
    .eq('user_id', user.id);

  if (clientsErr) {
    console.error('\nFailed to fetch agency_clients:', clientsErr.message);
  } else if (clients && clients.length > 0) {
    console.log('\n=== Agency Client Links ===');
    for (const c of clients) {
      const a = c.agencies as Record<string, unknown> | null;
      console.log(`  Agency: ${a?.name ?? '—'} (${a?.slug ?? '—'})`);
      console.log(`    Agency ID:    ${c.agency_id}`);
      console.log(`    Domain:       ${a?.custom_domain ?? '—'}`);
      console.log(`    Client since: ${c.created_at}`);
    }
  } else {
    console.log('\n  No agency client links.');
  }

  // 4. Bots owned by this user
  const { data: bots, error: botsErr } = await vb
    .from('bots')
    .select('id, agency_id, status, phone_e164, agent_id, llm_id, client_subscription_status, cancel_at_period_end, current_period_end, created_at')
    .eq('owner_user_id', user.id);

  if (botsErr) {
    console.error('\nFailed to fetch bots:', botsErr.message);
  } else if (bots && bots.length > 0) {
    console.log('\n=== Bots ===');
    for (const b of bots) {
      console.log(`  Bot ID:         ${b.id}`);
      console.log(`    Agency:       ${b.agency_id}`);
      console.log(`    Status:       ${b.status}`);
      console.log(`    Phone:        ${b.phone_e164 ?? '—'}`);
      console.log(`    Agent ID:     ${b.agent_id ?? '—'}`);
      console.log(`    LLM ID:       ${b.llm_id ?? '—'}`);
      console.log(`    Sub status:   ${b.client_subscription_status ?? '—'}`);
      console.log(`    Cancel at EOP:${b.cancel_at_period_end ? 'yes' : 'no'}`);
      console.log(`    Period end:   ${b.current_period_end ?? '—'}`);
      console.log(`    Created:      ${b.created_at}`);
    }
  } else {
    console.log('\n  No bots found.');
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
