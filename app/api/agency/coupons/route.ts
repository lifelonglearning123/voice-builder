import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// GET  /api/agency/coupons?agency_id=<uuid>
// POST /api/agency/coupons
//   Body: {
//     agency_id, code,
//     discount_kind: 'percent' | 'amount',
//     discount_value: number,            // percent: 1..100; amount: pence
//     currency?: string,                  // required when discount_kind='amount'
//     duration: 'once' | 'repeating' | 'forever',
//     duration_in_months?: number,        // required when duration='repeating'
//     max_redemptions?: number | null,
//   }
//
// Self-service coupon management for agency owners/admins. Every coupon is
// created on the platform Stripe with `metadata.agency_id` so the checkout
// route can reject cross-agency usage (see app/api/checkout/create-session).

export const runtime = 'nodejs';

const CODE_RE = /^[A-Z0-9_-]{1,50}$/i;
const ALLOWED_CURRENCIES = new Set(['gbp', 'usd', 'eur', 'cad', 'aud']);

interface CreateBody {
  agency_id?: string;
  code?: string;
  discount_kind?: 'percent' | 'amount';
  discount_value?: number;
  currency?: string;
  duration?: 'once' | 'repeating' | 'forever';
  duration_in_months?: number;
  max_redemptions?: number | null;
}

async function authorize(
  agencyId: string,
): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string }
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Not signed in' };

  const service = createSupabaseServiceClient();
  const { data: membership } = await service
    .from('agency_members')
    .select('role')
    .eq('agency_id', agencyId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agencyId = searchParams.get('agency_id')?.trim();
  if (!agencyId) {
    return NextResponse.json({ error: 'agency_id is required' }, { status: 400 });
  }

  const auth = await authorize(agencyId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const stripe = getStripe();
  try {
    // Stripe doesn't support filtering coupons by metadata. List promotion
    // codes (smaller per-agency volume in practice) and filter client-side.
    const codes = await stripe.promotionCodes.list({
      limit: 100,
      expand: ['data.coupon'],
    });

    const coupons = codes.data
      .filter((pc) => {
        const coupon = pc.coupon as Stripe.Coupon;
        const md = (coupon.metadata ?? null) as Record<string, string> | null;
        return md?.agency_id === agencyId;
      })
      .map((pc) => {
        const coupon = pc.coupon as Stripe.Coupon;
        return {
          promotion_code_id: pc.id,
          coupon_id: coupon.id,
          code: pc.code,
          active: pc.active && coupon.valid,
          percent_off: coupon.percent_off,
          amount_off: coupon.amount_off,
          currency: coupon.currency,
          duration: coupon.duration,
          duration_in_months: coupon.duration_in_months,
          max_redemptions: pc.max_redemptions,
          times_redeemed: pc.times_redeemed,
          created: pc.created,
        };
      });

    return NextResponse.json({ coupons });
  } catch (e) {
    console.error('[coupons] list failed:', e);
    return NextResponse.json(
      { error: 'Failed to load coupons. Please try again.' },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const agencyId = body.agency_id?.trim();
  if (!agencyId) {
    return NextResponse.json({ error: 'agency_id is required' }, { status: 400 });
  }

  const auth = await authorize(agencyId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // ---- Validate input -----------------------------------------------------
  const code = body.code?.trim();
  if (!code || !CODE_RE.test(code)) {
    return NextResponse.json(
      { error: 'Code must be 1–50 chars, letters/digits/underscore/hyphen only.' },
      { status: 400 },
    );
  }

  const kind = body.discount_kind;
  if (kind !== 'percent' && kind !== 'amount') {
    return NextResponse.json(
      { error: 'discount_kind must be "percent" or "amount".' },
      { status: 400 },
    );
  }

  const value = Number(body.discount_value);
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json(
      { error: 'Discount value must be a positive number.' },
      { status: 400 },
    );
  }
  if (kind === 'percent' && value > 100) {
    return NextResponse.json(
      { error: 'Percent off cannot exceed 100.' },
      { status: 400 },
    );
  }

  const duration = body.duration;
  if (duration !== 'once' && duration !== 'repeating' && duration !== 'forever') {
    return NextResponse.json(
      { error: 'Duration must be "once", "repeating", or "forever".' },
      { status: 400 },
    );
  }
  if (duration === 'repeating') {
    const m = Number(body.duration_in_months);
    if (!Number.isInteger(m) || m < 1 || m > 60) {
      return NextResponse.json(
        { error: 'duration_in_months must be a whole number between 1 and 60.' },
        { status: 400 },
      );
    }
  }

  let currency: string | undefined;
  if (kind === 'amount') {
    currency = body.currency?.toLowerCase().trim();
    if (!currency || !ALLOWED_CURRENCIES.has(currency)) {
      return NextResponse.json(
        { error: `Currency must be one of: ${Array.from(ALLOWED_CURRENCIES).map((c) => c.toUpperCase()).join(', ')}.` },
        { status: 400 },
      );
    }
  }

  // ---- Create coupon + promotion code on Stripe ---------------------------
  const stripe = getStripe();

  const couponArgs: Stripe.CouponCreateParams = {
    duration,
    metadata: { agency_id: agencyId },
  };
  if (kind === 'percent') {
    couponArgs.percent_off = value;
  } else {
    couponArgs.amount_off = Math.round(value);
    couponArgs.currency = currency!;
  }
  if (duration === 'repeating') {
    couponArgs.duration_in_months = Number(body.duration_in_months);
  }

  let coupon: Stripe.Coupon;
  try {
    coupon = await stripe.coupons.create(couponArgs);
  } catch (e) {
    console.error('[coupons] coupon create failed:', e);
    const msg = e instanceof Error ? e.message : 'Failed to create coupon.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const promoArgs: Stripe.PromotionCodeCreateParams = {
    coupon: coupon.id,
    code,
  };
  if (body.max_redemptions != null && body.max_redemptions > 0) {
    promoArgs.max_redemptions = Math.floor(body.max_redemptions);
  }

  try {
    const promo = await stripe.promotionCodes.create(promoArgs);
    return NextResponse.json({ ok: true, code: promo.code });
  } catch (e) {
    // The coupon was already created; roll it back so we don't leave orphans
    // in Stripe when the promotion code (often the code collides with an
    // existing one) fails.
    try {
      await stripe.coupons.del(coupon.id);
    } catch (rollbackErr) {
      console.error('[coupons] rollback failed:', rollbackErr);
    }
    console.error('[coupons] promotion code create failed:', e);
    const msg = e instanceof Error ? e.message : 'Failed to create promo code.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
