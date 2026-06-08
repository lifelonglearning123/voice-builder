// Usage: node --experimental-strip-types scripts/audit-coupons.ts
// Lists all promotion codes on the platform Stripe account, grouped by agency,
// and flags any code strings shared across multiple agencies.

import Stripe from 'stripe';
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
  } catch { /* rely on existing process.env */ }
}

loadEnv();

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('Missing STRIPE_SECRET_KEY in .env.local');
  process.exit(1);
}

const stripe = new Stripe(stripeKey);

async function main() {
  // Paginate through all promotion codes
  const allCodes: Stripe.PromotionCode[] = [];
  let page = await stripe.promotionCodes.list({ limit: 100, expand: ['data.promotion.coupon'] });
  allCodes.push(...page.data);
  while (page.has_more) {
    page = await stripe.promotionCodes.list({
      limit: 100,
      expand: ['data.promotion.coupon'],
      starting_after: page.data[page.data.length - 1].id,
    });
    allCodes.push(...page.data);
  }

  console.log(`\nTotal promotion codes found: ${allCodes.length}\n`);

  // Parse each code
  const rows = allCodes.map((pc) => {
    const raw = pc.promotion?.coupon;
    const coupon = (raw && typeof raw !== 'string' ? raw : null) as Stripe.Coupon | null;
    const agencyId = (coupon?.metadata as Record<string, string> | null)?.agency_id ?? null;
    return {
      promoId: pc.id,
      code: pc.code,
      active: pc.active && (coupon?.valid ?? false),
      agencyId,
      discount: coupon?.percent_off
        ? `${coupon.percent_off}% off`
        : coupon?.amount_off
          ? `${coupon.amount_off / 100} ${(coupon.currency ?? '').toUpperCase()} off`
          : '(no coupon)',
      duration: coupon?.duration ?? '?',
      redeemed: pc.times_redeemed,
      max: pc.max_redemptions ?? '∞',
    };
  });

  // --- No agency_id (orphaned / manually created) ---------------------------
  const noAgency = rows.filter((r) => !r.agencyId);
  if (noAgency.length > 0) {
    console.log('=== Missing agency_id metadata (will be rejected at checkout) ===');
    for (const r of noAgency) {
      console.log(`  ${r.code.padEnd(20)} active=${r.active}  ${r.discount}  redeemed=${r.redeemed}/${r.max}  promo=${r.promoId}`);
    }
    console.log('');
  }

  // --- Group by code string, flag duplicates --------------------------------
  const byCode = new Map<string, typeof rows>();
  for (const r of rows) {
    const existing = byCode.get(r.code) ?? [];
    existing.push(r);
    byCode.set(r.code, existing);
  }

  const duplicates = [...byCode.entries()].filter(([, list]) => list.length > 1);
  if (duplicates.length > 0) {
    console.log('=== Duplicate code strings (same code across multiple entries) ===');
    for (const [code, list] of duplicates) {
      console.log(`  Code: ${code}`);
      for (const r of list) {
        console.log(`    agency_id=${r.agencyId ?? 'NONE'}  active=${r.active}  ${r.discount}  redeemed=${r.redeemed}/${r.max}  promo=${r.promoId}`);
      }
    }
    console.log('');
  } else {
    console.log('No duplicate code strings found.\n');
  }

  // --- Full list grouped by agency ------------------------------------------
  const byAgency = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.agencyId ?? '(no agency)';
    const existing = byAgency.get(key) ?? [];
    existing.push(r);
    byAgency.set(key, existing);
  }

  console.log('=== All codes by agency ===');
  for (const [agencyId, list] of byAgency) {
    console.log(`\n  Agency: ${agencyId}`);
    for (const r of list) {
      const status = r.active ? 'active' : 'inactive';
      console.log(`    ${r.code.padEnd(20)} ${status.padEnd(8)} ${r.discount.padEnd(15)} duration=${r.duration}  redeemed=${r.redeemed}/${r.max}`);
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
