import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// DELETE /api/agency/coupons/[id]?agency_id=<uuid>
//
// Deletes a Stripe coupon by id. Authorisation flow:
//   1. Caller passes ?agency_id=… for the agency they're acting as.
//   2. We verify the caller is owner/admin of that agency.
//   3. We resolve the agency's Stripe storage mode (direct vs platform)
//      and target that account for the delete.
//   4. In platform mode we additionally verify the coupon's
//      metadata.agency_id matches — so one platform-tenant agency can't
//      pass another's coupon id and nuke it. In direct mode this check is
//      redundant because the coupon would 404 on the wrong connected
//      account anyway.
//
// Deleting the coupon also stops its promotion codes from applying to new
// checkouts (Stripe handles this automatically). Existing subscriptions
// keep their discount.

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: couponId } = await params;
  if (!couponId) {
    return NextResponse.json({ error: 'coupon id required' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const agencyId = searchParams.get('agency_id')?.trim();
  if (!agencyId) {
    return NextResponse.json({ error: 'agency_id is required' }, { status: 400 });
  }

  // Authorise the caller as owner/admin of the agency they say they own.
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

  // Resolve Stripe storage mode for this agency.
  const { data: agency } = await service
    .from('agencies')
    .select(
      'stripe_connect_account_id, stripe_connect_onboarding_complete, use_direct_charges',
    )
    .eq('id', agencyId)
    .single();
  const useDirect =
    !!agency?.use_direct_charges &&
    !!agency.stripe_connect_account_id &&
    !!agency.stripe_connect_onboarding_complete;
  const scope = useDirect
    ? { stripeAccount: agency!.stripe_connect_account_id! }
    : undefined;

  const stripe = getStripe();

  // Platform mode: verify the coupon belongs to the caller's agency before
  // we delete it (defence against ID-guessing attacks across tenants).
  if (!scope) {
    try {
      const coupon = await stripe.coupons.retrieve(couponId);
      const couponAgencyId =
        ((coupon.metadata ?? null) as Record<string, string> | null)?.agency_id ?? null;
      if (couponAgencyId !== agencyId) {
        return NextResponse.json(
          { error: 'Coupon does not belong to this workspace.' },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
    }
  }

  try {
    await stripe.coupons.del(couponId, undefined, scope);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[coupons] delete failed:', e);
    return NextResponse.json(
      { error: 'Failed to delete coupon.' },
      { status: 502 },
    );
  }
}
