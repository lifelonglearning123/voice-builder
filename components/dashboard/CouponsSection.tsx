'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

// Self-service coupons for agency owners/admins.
//
// Lists the agency's existing Stripe promo codes and provides a small form
// to create new ones. All scoping (which agency owns which coupon) is
// enforced server-side via `metadata.agency_id` — the client only displays
// what the API returns and asks for confirmation on destructive actions.

interface CouponRow {
  promotion_code_id: string;
  coupon_id: string;
  code: string;
  active: boolean;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: 'once' | 'repeating' | 'forever';
  duration_in_months: number | null;
  max_redemptions: number | null;
  times_redeemed: number;
  created: number;
}

interface Props {
  agencyId: string;
  /** Default currency for amount-off coupons. Uppercase ISO code. */
  defaultCurrency: string;
}

export function CouponsSection({ agencyId, defaultCurrency }: Props) {
  const [coupons, setCoupons] = useState<CouponRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/agency/coupons?agency_id=${encodeURIComponent(agencyId)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error || 'Failed to load coupons.');
        return;
      }
      setCoupons(data.coupons as CouponRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load coupons.');
    }
  }, [agencyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(couponId: string) {
    const ok = window.confirm(
      'Delete this coupon? It will stop applying to new checkouts. Existing subscribers keep their discount.',
    );
    if (!ok) return;
    setDeletingId(couponId);
    try {
      const res = await fetch(
        `/api/agency/coupons/${encodeURIComponent(couponId)}?agency_id=${encodeURIComponent(agencyId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Delete failed.');
        return;
      }
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
      <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
        DISCOUNTS
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
        Promo codes
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        Create codes your clients can apply at checkout. Each code is scoped
        to this workspace — clients on other workspaces can&rsquo;t use it.
        Share via URL:{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
          /bots/new/6?promo=YOURCODE
        </code>
      </p>

      <div className="mt-6 space-y-2">
        {loadError && (
          <div className="rounded-md border border-red-100 bg-red-50/60 px-3 py-2 text-sm text-red-800">
            {loadError}
          </div>
        )}
        {coupons === null && !loadError && (
          <p className="text-sm text-slate-400">Loading&hellip;</p>
        )}
        {coupons && coupons.length === 0 && !loadError && (
          <p className="text-sm text-slate-400">No promo codes yet.</p>
        )}
        {coupons &&
          coupons.map((c) => (
            <div
              key={c.promotion_code_id}
              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono-tight text-sm font-semibold text-slate-900">
                    {c.code}
                  </code>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {describeCoupon(c)}
                  </span>
                  {!c.active && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                      inactive
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {c.times_redeemed} used
                  {c.max_redemptions ? ` / ${c.max_redemptions} max` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(c.coupon_id)}
                disabled={deletingId === c.coupon_id}
                className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                {deletingId === c.coupon_id ? 'Deleting&hellip;' : 'Delete'}
              </button>
            </div>
          ))}
      </div>

      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="wizard-pill mt-6"
        >
          + New promo code
        </button>
      ) : (
        <CreateForm
          agencyId={agencyId}
          defaultCurrency={defaultCurrency}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Create form
 * ------------------------------------------------------------------------- */

const CURRENCIES = ['GBP', 'USD', 'EUR', 'CAD', 'AUD'] as const;

function CreateForm({
  agencyId,
  defaultCurrency,
  onCreated,
  onCancel,
}: {
  agencyId: string;
  defaultCurrency: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState<string>(
    (defaultCurrency || 'GBP').toUpperCase(),
  );
  const [duration, setDuration] = useState<'once' | 'repeating' | 'forever'>(
    'once',
  );
  const [months, setMonths] = useState('3');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      setError('Discount value must be a positive number.');
      return;
    }
    // Amount-off is entered in major units (e.g. £20) — convert to pence.
    const payloadValue =
      kind === 'amount' ? Math.round(numericValue * 100) : numericValue;

    setSubmitting(true);
    try {
      const res = await fetch('/api/agency/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agency_id: agencyId,
          code: code.trim(),
          discount_kind: kind,
          discount_value: payloadValue,
          ...(kind === 'amount' ? { currency } : {}),
          duration,
          ...(duration === 'repeating'
            ? { duration_in_months: Number(months) }
            : {}),
          ...(maxRedemptions.trim()
            ? { max_redemptions: Number(maxRedemptions) }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to create promo code.');
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-slate-50/40 p-5"
    >
      <Field label="Code" hint="What clients type at checkout. Letters, digits, _, –.">
        <input
          type="text"
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="EARLY20"
          className="wizard-focus block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500"
        />
      </Field>

      <Field label="Discount type">
        <div className="flex gap-3">
          <Radio
            label="Percent off"
            checked={kind === 'percent'}
            onChange={() => setKind('percent')}
          />
          <Radio
            label="Amount off"
            checked={kind === 'amount'}
            onChange={() => setKind('amount')}
          />
        </div>
      </Field>

      <Field
        label={kind === 'percent' ? 'Percent off' : 'Amount off'}
        hint={
          kind === 'percent'
            ? 'A number from 0.01 to 100.'
            : 'In the currency below, e.g. 20 for £20.'
        }
      >
        <div className="flex items-stretch gap-2">
          <input
            type="number"
            required
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === 'percent' ? '20' : '10.00'}
            className="wizard-focus block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500"
          />
          {kind === 'amount' && (
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="wizard-focus rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </Field>

      <Field label="Duration" hint="How long the discount applies on a subscription.">
        <div className="flex flex-wrap gap-3">
          <Radio
            label="Once"
            checked={duration === 'once'}
            onChange={() => setDuration('once')}
          />
          <Radio
            label="Repeating"
            checked={duration === 'repeating'}
            onChange={() => setDuration('repeating')}
          />
          <Radio
            label="Forever"
            checked={duration === 'forever'}
            onChange={() => setDuration('forever')}
          />
        </div>
        {duration === 'repeating' && (
          <input
            type="number"
            required
            min={1}
            max={60}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            placeholder="3"
            className="wizard-focus mt-2 block w-28 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500"
          />
        )}
      </Field>

      <Field
        label="Max uses (optional)"
        hint="Total times the code can be redeemed across all clients. Leave blank for unlimited."
      >
        <input
          type="number"
          min={1}
          value={maxRedemptions}
          onChange={(e) => setMaxRedemptions(e.target.value)}
          placeholder="100"
          className="wizard-focus block w-28 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500"
        />
      </Field>

      {error && (
        <div className="rounded-md border border-red-100 bg-red-50/60 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={submitting} className="wizard-pill">
          {submitting ? 'Creating…' : 'Create promo code'}
          {!submitting && <span aria-hidden="true">→</span>}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Radio({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 accent-slate-900"
      />
      {label}
    </label>
  );
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function describeCoupon(c: CouponRow): string {
  const parts: string[] = [];
  if (c.percent_off != null) {
    parts.push(`${stripTrailingZero(c.percent_off)}% off`);
  } else if (c.amount_off != null && c.currency) {
    parts.push(
      `${currencySymbol(c.currency)}${(c.amount_off / 100).toFixed(2)} off`,
    );
  }
  if (c.duration === 'once') parts.push('first invoice');
  else if (c.duration === 'forever') parts.push('forever');
  else if (c.duration === 'repeating' && c.duration_in_months) {
    parts.push(`${c.duration_in_months} months`);
  }
  return parts.join(' · ');
}

function currencySymbol(currency: string): string {
  switch (currency.toLowerCase()) {
    case 'gbp':
      return '£';
    case 'usd':
      return '$';
    case 'eur':
      return '€';
    case 'cad':
      return 'CA$';
    case 'aud':
      return 'A$';
    default:
      return currency.toUpperCase() + ' ';
  }
}

function stripTrailingZero(n: number): string {
  return n.toString().replace(/\.0+$/, '');
}
