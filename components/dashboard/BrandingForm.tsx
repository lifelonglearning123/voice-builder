'use client';

import { useState, type FormEvent } from 'react';

interface BrandingFormProps {
  agencyId: string;
  initial: {
    name: string;
    brand_logo_url: string | null;
    brand_color: string | null;
    custom_domain: string | null;
    custom_domain_verified: boolean;
    client_price_pence: number | null;
    client_currency: string | null;
  };
}

const CURRENCIES = ['GBP', 'USD', 'EUR', 'CAD', 'AUD'] as const;

export function BrandingForm({ agencyId, initial }: BrandingFormProps) {
  // Agency name and custom domain are locked at the platform level — they
  // reflect what's saved in the DB but the form never lets the user change
  // them. Kept as plain values (not state) so the preview still renders.
  const name = initial.name;
  const domain = initial.custom_domain ?? '';
  const [logoUrl, setLogoUrl] = useState(initial.brand_logo_url ?? '');
  const [color, setColor] = useState(initial.brand_color ?? '#0071e3');
  const [priceText, setPriceText] = useState(
    initial.client_price_pence != null ? (initial.client_price_pence / 100).toFixed(2) : '',
  );
  const [currency, setCurrency] = useState(initial.client_currency ?? 'GBP');

  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('saving');
    setError(null);

    // Convert price text to pence. Allow blank to clear.
    let pricePence: number | null = null;
    if (priceText.trim()) {
      const pounds = Number(priceText);
      if (!isFinite(pounds) || pounds < 0) {
        setError('Price must be a positive number.');
        setStatus('error');
        return;
      }
      pricePence = Math.round(pounds * 100);
    }

    const res = await fetch('/api/agency/branding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agency_id: agencyId,
        // name and custom_domain are locked at the platform level —
        // intentionally omitted from the payload.
        brand_logo_url: logoUrl,
        brand_color: color,
        client_price_pence: pricePence,
        client_currency: currency,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Save failed');
      setStatus('error');
      return;
    }

    setStatus('saved');
    // Refresh the page so the live preview + verification banner reflect changes.
    setTimeout(() => window.location.reload(), 500);
  }

  // Live preview style — the value in `color` drives the accent on the preview
  // tile to the right of the form.
  const previewStyle = {
    ['--agency-accent' as string]: color,
    ['--agency-accent-rgb' as string]: hexToRgbString(color),
  } as React.CSSProperties;

  return (
    <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-[1.4fr,1fr]">
      <div className="space-y-6">
        <Field
          label="Agency name"
          locked
          hint="Locked — set by the platform admin at the deployment level."
        >
          <input
            type="text"
            value={name}
            readOnly
            disabled
            className={lockedInputClass}
          />
        </Field>

        <Field
          label="Logo URL"
          optional
          hint="Web-accessible image URL. PNG or SVG with a transparent background works best. Recommended height ~56px."
        >
          <input
            type="url"
            placeholder="https://your-site.com/logo.png"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field
          label="Brand colour"
          hint="A single accent colour. Used for hero glow, CTA hover, audio waveform, focus rings. Pick something distinctive but not so saturated it dominates."
        >
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-md border border-slate-200 bg-white p-1"
              aria-label="Pick brand colour"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#0071e3"
              className={`${inputClass} max-w-[140px] font-mono-tight`}
            />
          </div>
        </Field>

        <Field
          label="Custom domain"
          locked
          hint={
            initial.custom_domain && initial.custom_domain_verified
              ? 'Locked — set by the platform admin. Verified and live.'
              : 'Locked — set by the platform admin at the deployment level.'
          }
        >
          <input
            type="text"
            placeholder="voice-builder.your-agency.com"
            value={domain}
            readOnly
            disabled
            className={lockedInputClass}
          />
        </Field>

        <div className="grid grid-cols-[1fr,140px] gap-3">
          <Field label="Client price" hint="What you charge your SMB clients per month.">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                {currencySymbol(currency)}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="99.00"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                className={`${inputClass} pl-7`}
              />
            </div>
          </Field>
          <Field label="Currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={inputClass}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={status === 'saving'}
            className="wizard-pill disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'saving' ? 'Saving…' : 'Save branding'}
          </button>
          {status === 'saved' && (
            <span className="text-xs font-medium text-green-700">
              ✓ Saved. Reloading…
            </span>
          )}
          {status === 'error' && error && (
            <span className="text-xs font-medium text-red-700">{error}</span>
          )}
        </div>
      </div>

      {/* Live preview tile */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="font-mono-tight text-[11px] uppercase tracking-[0.18em] text-slate-400">
          Live preview
        </p>
        <div
          className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white"
          style={previewStyle}
        >
          <div
            className="relative px-5 py-7"
            style={{
              backgroundImage:
                'radial-gradient(60% 50% at 50% 0%, rgba(var(--agency-accent-rgb), 0.18), transparent 70%)',
            }}
          >
            <div className="flex items-center gap-2.5">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={name || 'Logo'}
                  className="h-7 w-auto max-w-[120px] object-contain"
                />
              ) : (
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
                  style={{ background: color }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M10 2a4 4 0 00-4 4v4a4 4 0 008 0V6a4 4 0 00-4-4zM5 11a5 5 0 0010 0h-1.5a3.5 3.5 0 01-7 0H5z" />
                  </svg>
                </span>
              )}
              <span className="text-sm font-semibold tracking-tight text-slate-900">
                {name || 'Your agency'}
              </span>
            </div>
            <p className="mt-5 text-[22px] font-semibold leading-tight tracking-[-0.035em] text-slate-900">
              Never miss<br />another call.
            </p>
            <button
              type="button"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-medium text-white"
              style={{ boxShadow: `0 6px 18px rgba(${hexToRgbString(color)}, 0.35)` }}
              tabIndex={-1}
            >
              Start free
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="border-t border-slate-200 px-5 py-4">
            <p className="font-mono-tight text-[10px] uppercase tracking-[0.18em] text-slate-400">
              Audio waveform
            </p>
            <div className="mt-2 flex h-6 items-center gap-[2px]">
              {WAVE_HEIGHTS.map((h, i) => (
                <span
                  key={i}
                  className="inline-block w-[2px] rounded-full"
                  style={{ height: `${h}%`, background: color, opacity: 0.6 }}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11px] tracking-tight text-slate-500">
          The accent colour appears in subtle places — hero glow, CTA hover, waveform.
          Keep the rest slate so it reads as deliberate.
        </p>
      </div>
    </form>
  );
}

const WAVE_HEIGHTS = [
  30, 50, 70, 85, 60, 45, 75, 90, 65, 40, 55, 80, 95, 70, 50, 35, 45, 60, 75, 55, 40, 30, 20, 25,
];

function hexToRgbString(hex: string): string {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return '0, 113, 227';
  const v = m[1];
  return `${parseInt(v.slice(0, 2), 16)}, ${parseInt(v.slice(2, 4), 16)}, ${parseInt(v.slice(4, 6), 16)}`;
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'GBP': return '£';
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'CAD': return 'CA$';
    case 'AUD': return 'A$';
    default: return '';
  }
}

const inputClass =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-900/[0.04]';

const lockedInputClass =
  'w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 placeholder:text-slate-400 cursor-not-allowed';

function Field({
  label,
  hint,
  optional,
  locked,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2 text-xs font-medium tracking-tight text-slate-700">
        {label}
        {optional && (
          <span className="font-normal text-[11px] text-slate-400">Optional</span>
        )}
        {locked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium tracking-tight text-slate-500">
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M3.5 5V3.5a2.5 2.5 0 015 0V5M2.5 5h7v5.5h-7V5z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Locked
          </span>
        )}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <span className="mt-1.5 block text-[11px] leading-snug tracking-tight text-slate-500">
          {hint}
        </span>
      )}
    </label>
  );
}
