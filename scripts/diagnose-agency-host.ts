// Usage:
//   node --experimental-strip-types scripts/diagnose-agency-host.ts <host-or-url> [agency-slug]
//
// Examples:
//   node --experimental-strip-types scripts/diagnose-agency-host.ts voice-builder.cloudva.com
//   node --experimental-strip-types scripts/diagnose-agency-host.ts https://cloudva.com/signup
//   node --experimental-strip-types scripts/diagnose-agency-host.ts www.cloudva.com cloudva
//
// Replays the exact logic of lib/agency/resolve.ts against the given host
// (and optional ?agency= slug) so you can see why a client got the
// "We couldn't identify which workspace you're signing in to" error on
// /api/auth/send-magic-link.
//
// Read-only. Safe to run against prod.

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
      let val = trimmed.slice(eq + 1).trim();
      // Strip inline `# comment` on unquoted values — Next.js / real dotenv
      // do this, and the .env.local in this repo relies on it.
      if (!/^["']/.test(val)) {
        const hash = val.indexOf(' #');
        if (hash !== -1) val = val.slice(0, hash).trim();
      }
      val = val.replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local missing — fall through to process.env
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const rawHostArg = process.argv[2]?.trim();
const querySlug = process.argv[3]?.trim() || null;
if (!rawHostArg) {
  console.error(
    'Usage: node --experimental-strip-types scripts/diagnose-agency-host.ts <host-or-url> [agency-slug]',
  );
  process.exit(1);
}

// Accept either a bare host ("cloudva.com") or a full URL. resolveAgency
// receives the raw Host header from Next, which never has scheme/path —
// but it's friendlier to let the operator paste whatever URL the client
// sent them.
function extractHost(input: string): string {
  try {
    if (input.includes('://')) return new URL(input).host;
  } catch {
    // fall through
  }
  return input;
}

const rawHost = extractHost(rawHostArg);
const cleanHost = rawHost.split(':')[0].toLowerCase();
const defaultSlug = process.env.DEFAULT_AGENCY_SLUG || null;

const vb = createClient(supabaseUrl, serviceKey, {
  db: { schema: 'vb' },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function queryVerified() {
  return vb
    .from('agencies')
    .select('id, slug, name, custom_domain, custom_domain_verified, from_email, from_name')
    .eq('custom_domain', cleanHost)
    .eq('custom_domain_verified', true)
    .maybeSingle();
}

async function main() {
  console.log(`\nInput:        ${rawHostArg}`);
  console.log(`Cleaned host: ${cleanHost}`);
  console.log(`Query slug:   ${querySlug ?? '— (none)'}`);
  console.log(`DEFAULT_AGENCY_SLUG: ${defaultSlug ?? '— (unset)'}\n`);

  // --- Step 1: custom_domain match (verified) ---
  console.log('=== Step 1: custom_domain match (verified) ===');
  // Retry once — the very first outbound request on cold sandboxes sometimes
  // fails TLS negotiation with `TypeError: fetch failed`.
  let verifiedMatch: Awaited<ReturnType<typeof queryVerified>>['data'] = null;
  let e1: Awaited<ReturnType<typeof queryVerified>>['error'] = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await queryVerified();
    verifiedMatch = r.data;
    e1 = r.error;
    if (!e1) break;
  }
  if (e1) {
    console.error('  Query error:', e1.message);
  } else if (verifiedMatch) {
    console.log('  ✓ MATCH — resolveAgency would return this row:');
    printRow(verifiedMatch);
    return finish(verifiedMatch);
  } else {
    console.log('  ✗ No verified custom_domain row for this host.');
  }

  // Helpful: is there a row with this domain but verified=false?
  const { data: unverifiedMatch } = await vb
    .from('agencies')
    .select('id, slug, name, custom_domain, custom_domain_verified, from_email, from_name')
    .eq('custom_domain', cleanHost)
    .maybeSingle();
  if (unverifiedMatch && !unverifiedMatch.custom_domain_verified) {
    console.log(
      '\n  ⚠ Found a row with this custom_domain but custom_domain_verified=false.',
    );
    console.log('    Fix:');
    console.log(
      `      UPDATE vb.agencies SET custom_domain_verified = true WHERE slug = '${unverifiedMatch.slug}';`,
    );
    printRow(unverifiedMatch);
  }

  // Helpful: near-miss search — rows whose custom_domain contains a piece
  // of the host (e.g. typed "www.cloudva.com" but row stored "cloudva.com").
  const needle = cleanHost.replace(/^www\./, '').split('.')[0];
  if (needle && needle.length >= 3) {
    const { data: near } = await vb
      .from('agencies')
      .select('slug, custom_domain, custom_domain_verified')
      .ilike('custom_domain', `%${needle}%`);
    if (near && near.length) {
      console.log(`\n  ℹ Near-miss rows (custom_domain ILIKE %${needle}%):`);
      for (const r of near) {
        console.log(
          `    - slug=${r.slug}  custom_domain=${r.custom_domain}  verified=${r.custom_domain_verified}`,
        );
      }
    }
  }

  // --- Step 2: ?agency= query slug ---
  console.log('\n=== Step 2: ?agency= query slug ===');
  if (!querySlug) {
    console.log('  (skipped — no slug passed)');
  } else {
    const { data: slugMatch } = await vb
      .from('agencies')
      .select('id, slug, name, custom_domain, custom_domain_verified, from_email, from_name')
      .eq('slug', querySlug)
      .maybeSingle();
    if (slugMatch) {
      console.log(`  ✓ MATCH — resolveAgency would return this row (via ?agency=${querySlug}):`);
      printRow(slugMatch);
      return finish(slugMatch);
    }
    console.log(`  ✗ No row with slug='${querySlug}'.`);
  }

  // --- Step 3: DEFAULT_AGENCY_SLUG env fallback ---
  console.log('\n=== Step 3: DEFAULT_AGENCY_SLUG env fallback ===');
  if (!defaultSlug) {
    console.log('  (skipped — DEFAULT_AGENCY_SLUG not set)');
  } else {
    const { data: defMatch } = await vb
      .from('agencies')
      .select('id, slug, name, custom_domain, custom_domain_verified, from_email, from_name')
      .eq('slug', defaultSlug)
      .maybeSingle();
    if (defMatch) {
      console.log(`  ✓ MATCH — resolveAgency would return this row (via DEFAULT_AGENCY_SLUG):`);
      printRow(defMatch);
      return finish(defMatch);
    }
    console.log(`  ✗ No row with slug='${defaultSlug}'.`);
  }

  console.log('\n=== Verdict ===');
  console.log('  resolveAgency would return NULL → client sees:');
  console.log("    \"We couldn't identify which workspace you're signing in to.\"");
  console.log('\n  Next steps:');
  console.log('   1. Confirm the agency row exists with the EXACT custom_domain the client typed.');
  console.log('   2. If it exists, set custom_domain_verified = true.');
  console.log('   3. If the client is on a different hostname (www vs apex, or a subdomain),');
  console.log('      either redirect them or update the row to match.');
}

function printRow(row: {
  id: string;
  slug: string;
  name: string;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  from_email: string | null;
  from_name: string | null;
}) {
  console.log(`    id:                     ${row.id}`);
  console.log(`    name:                   ${row.name}`);
  console.log(`    slug:                   ${row.slug}`);
  console.log(`    custom_domain:          ${row.custom_domain ?? '—'}`);
  console.log(`    custom_domain_verified: ${row.custom_domain_verified}`);
  console.log(`    from_email:             ${row.from_email ?? '— (will block magic-link send)'}`);
  console.log(`    from_name:              ${row.from_name ?? '— (will block magic-link send)'}`);
}

function finish(row: { from_email: string | null; from_name: string | null }) {
  if (!row.from_email || !row.from_name) {
    console.log('\n  ⚠ Agency resolves, but from_email / from_name is null.');
    console.log('    The next call will fail with a DIFFERENT error:');
    console.log("      \"Sign-in email isn't configured for this workspace yet.\"");
    console.log('    Set both columns on vb.agencies before the client retries.');
  } else {
    console.log('\n  ✓ resolveAgency would succeed. The error must be coming from somewhere else —');
    console.log('    check Vercel logs for /api/auth/send-magic-link.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
