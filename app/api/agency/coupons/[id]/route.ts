import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// DELETE /api/agency/coupons/[id]
//
// Deletes a Stripe coupon by id. The caller must be owner/admin of the
// agency stored in the coupon's `metadata.agency_id` — that's how we prevent
// one agency from deleting another's coupons. Deleting the coupon also stops
// its promotion codes from applying to new checkouts (Stripe handles this
// automatically); existing subscriptions keep their discount.

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: couponId } = await params;
  if (!couponId) {
    return NextResponse.json({ error: 'coupon id required' }, { status: 400 });
  }

  const stripe = getStripe();

  // Retrieve the coupon first so we can check its agency_id metadata.
  let agencyId: string | null = null;
  try {
    const coupon = await stripe.coupons.retrieve(couponId);
    agencyId =
      ((coupon.metadata ?? null) as Record<string, string> | null)?.agency_id ?? null;
  } catch {
    return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
  }
  if (!agencyId) {
    return NextResponse.json(
      { error: 'Coupon is not agency-scoped — refusing to delete.' },
      { status: 400 },
    );
  }

  // Authorize: caller must be owner/admin of the agency on the coupon.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const service = createSupabaseServiceClient();
  const { data: membership } = await service
    .from('agency_members')
    .select('role')
    .eq('agency_id', agencyId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await stripe.coupons.del(couponId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[coupons] delete failed:', e);
    return NextResponse.json(
      { error: 'Failed to delete coupon.' },
      { status: 502 },
    );
  }
}
