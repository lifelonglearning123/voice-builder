import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';

// POST /api/agency/branding
// Body (JSON):
//   {
//     agency_id: string,
//     brand_logo_url?: string | null,
//     brand_color?: string | null,         // hex, "#RRGGBB"
//     client_price_pence?: number | null,
//     client_currency?: string | null       // 'GBP' | 'USD' | ...
//   }
//
// `name` and `custom_domain` are accepted in the body for backwards
// compatibility but silently ignored — those fields are platform-locked
// (managed via DEFAULT_BRAND_NAME and DNS routing respectively).
//
// Updates the agency's branding. Owner / admin role required. Empty strings
// are treated as null (clearing the field).

export const runtime = 'nodejs';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const ALLOWED_CURRENCIES = new Set(['GBP', 'USD', 'EUR', 'CAD', 'AUD']);

interface Body {
  agency_id?: string;
  name?: string;
  brand_logo_url?: string | null;
  brand_color?: string | null;
  custom_domain?: string | null;
  client_price_pence?: number | null;
  client_currency?: string | null;
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const agencyId = body.agency_id?.trim();
  if (!agencyId) {
    return NextResponse.json({ error: 'agency_id is required' }, { status: 400 });
  }

  // Permission — must be owner or admin of this agency.
  const { data: membership } = await supabase
    .from('agency_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', agencyId)
    .maybeSingle();
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Build the partial update — only include fields present in the request.
  // An empty string clears the value; undefined leaves it untouched.
  const update: Record<string, unknown> = {};

  // Agency name and custom domain are platform-locked: the deployment owns
  // them (set via DEFAULT_BRAND_NAME and DNS routing respectively), so the
  // self-service form can't change them. We silently drop the fields rather
  // than 400 so an older client that still sends them keeps working.
  // body.name and body.custom_domain are intentionally ignored here.

  if (body.brand_logo_url !== undefined) {
    const v = body.brand_logo_url?.trim();
    if (!v) {
      update.brand_logo_url = null;
    } else {
      if (!URL_RE.test(v)) {
        return NextResponse.json(
          { error: 'Logo URL must start with http:// or https://' },
          { status: 400 },
        );
      }
      update.brand_logo_url = v;
    }
  }

  if (body.brand_color !== undefined) {
    const v = body.brand_color?.trim();
    if (!v) {
      update.brand_color = null;
    } else {
      const normalised = normaliseHex(v);
      if (!normalised) {
        return NextResponse.json(
          { error: 'Brand colour must be a hex value like #0071e3' },
          { status: 400 },
        );
      }
      update.brand_color = normalised;
    }
  }

  // body.custom_domain is intentionally ignored — see the locked-fields note
  // above. DNS routing is platform-managed.

  if (body.client_price_pence !== undefined) {
    if (body.client_price_pence === null) {
      update.client_price_pence = null;
    } else {
      const p = Number(body.client_price_pence);
      if (!Number.isInteger(p) || p < 0 || p > 100_000_00) {
        return NextResponse.json(
          { error: 'Price must be a whole number of pence between 0 and 10,000,000' },
          { status: 400 },
        );
      }
      update.client_price_pence = p;
    }
  }

  if (body.client_currency !== undefined) {
    const v = body.client_currency?.trim().toUpperCase();
    if (!v) {
      update.client_currency = null;
    } else if (!ALLOWED_CURRENCIES.has(v)) {
      return NextResponse.json(
        { error: `Currency must be one of: ${Array.from(ALLOWED_CURRENCIES).join(', ')}` },
        { status: 400 },
      );
    } else {
      update.client_currency = v;
    }
  }

  update.updated_at = new Date().toISOString();

  // Use the service client to bypass RLS — we've already verified permission.
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from('agencies')
    .update(update)
    .eq('id', agencyId);

  if (error) {
    console.error('[agency/branding] update failed:', error);
    return NextResponse.json({ error: 'Failed to save branding' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function normaliseHex(input: string): string | null {
  const v = input.trim();
  if (HEX_RE.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return '#' + v.slice(1).split('').map((c) => c + c).join('').toLowerCase();
  }
  return null;
}
