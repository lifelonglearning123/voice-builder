import { headers } from 'next/headers';
import { resolveAgency, type AgencyRow } from './resolve';

// Marketing-page theming. Each public route calls this once on the server to
// determine which agency owns the request and what colours/copy to use.
//
// Falls back to a generic "Voice Builder" identity (slate accent) if no
// agency resolves — covers preview URLs, dev, and bare *.vercel.app domains.

export interface MarketingAgency {
  /** Database id, null in the generic fallback. */
  id: string | null;
  /** Public-facing brand name. */
  name: string;
  /** URL to a square logo. May be null — fallback uses a wordmark. */
  logoUrl: string | null;
  /** Hex string starting with '#'. Used as a single page accent. */
  brandColor: string;
  /** Pence (e.g. 9900 = £99.00). Drives the pricing card. */
  pricePence: number;
  /** ISO 4217 currency code (uppercase). */
  currency: string;
  /** Whether this is the generic fallback (no real agency matched). */
  isFallback: boolean;
}

const FALLBACK: MarketingAgency = {
  id: null,
  name: 'Voice Builder',
  logoUrl: null,
  brandColor: '#0071e3',
  pricePence: 9900,
  currency: 'GBP',
  isFallback: true,
};

export async function getMarketingAgency(opts?: {
  querySlug?: string | null;
}): Promise<MarketingAgency> {
  const h = await headers();
  const host = h.get('host');
  const row = await resolveAgency({ host, querySlug: opts?.querySlug ?? null });
  const overrides = readEnvOverrides();

  if (!row) {
    return {
      ...FALLBACK,
      name: overrides.name ?? FALLBACK.name,
      logoUrl: overrides.logoUrl ?? FALLBACK.logoUrl,
      brandColor: overrides.brandColor ?? FALLBACK.brandColor,
      pricePence: overrides.pricePence ?? FALLBACK.pricePence,
      currency: overrides.currency ?? FALLBACK.currency,
    };
  }

  return {
    id: row.id,
    name: overrides.name ?? row.name,
    logoUrl: overrides.logoUrl ?? row.brand_logo_url,
    brandColor:
      overrides.brandColor ?? normaliseHex(row.brand_color) ?? FALLBACK.brandColor,
    pricePence: overrides.pricePence ?? row.client_price_pence ?? FALLBACK.pricePence,
    currency: (overrides.currency ?? row.client_currency ?? FALLBACK.currency).toUpperCase(),
    isFallback: false,
  };
}

interface EnvOverrides {
  name: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  pricePence: number | null;
  currency: string | null;
}

function readEnvOverrides(): EnvOverrides {
  const name = process.env.DEFAULT_BRAND_NAME?.trim() || null;
  const logoUrl = process.env.DEFAULT_BRAND_LOGO_URL?.trim() || null;
  const brandColor = normaliseHex(process.env.DEFAULT_BRAND_COLOR?.trim() ?? null);
  const priceRaw = process.env.DEFAULT_BRAND_PRICE_PENCE?.trim();
  const pricePence = priceRaw && /^\d+$/.test(priceRaw) ? parseInt(priceRaw, 10) : null;
  const currency = process.env.DEFAULT_BRAND_CURRENCY?.trim().toUpperCase() || null;
  return { name, logoUrl, brandColor, pricePence, currency };
}

// Format pence as a price string (£99 / $99). Drops the .00 when whole.
export function formatPrice(pence: number, currency: string): string {
  const symbol = currencySymbol(currency);
  const whole = Math.floor(pence / 100);
  const fraction = pence % 100;
  if (fraction === 0) return `${symbol}${whole}`;
  return `${symbol}${whole}.${fraction.toString().padStart(2, '0')}`;
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'GBP':
      return '£';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'CAD':
      return 'CA$';
    case 'AUD':
      return 'A$';
    default:
      return `${currency} `;
  }
}

function normaliseHex(input: string | null): string | null {
  if (!input) return null;
  const v = input.trim();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return '#' + v.slice(1).split('').map((c) => c + c).join('');
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  return null;
}

// Build the `--agency-accent` CSS variable + a translucent variant for glows.
// Returns an inline-style object the layout/shell can spread on a wrapper.
export function agencyStyle(agency: MarketingAgency): React.CSSProperties {
  const rgb = hexToRgb(agency.brandColor);
  return {
    ['--agency-accent' as string]: agency.brandColor,
    ['--agency-accent-rgb' as string]: `${rgb.r}, ${rgb.g}, ${rgb.b}`,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return { r: 0, g: 113, b: 227 };
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}
