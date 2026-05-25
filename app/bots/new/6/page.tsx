'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { Field, inputClass } from '@/components/wizard/Field.tsx';

const E164_RE = /^\+\d{8,15}$/;

const COUNTRIES: Array<{ value: string; label: string }> = [
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
];

type Tab = 'paste' | 'buy';
type NumberType = 'local' | 'tollfree' | 'mobile';

interface AvailableNumber {
  phone_number: string;
  friendly_name: string;
  locality: string | null;
  region: string | null;
  iso_country: string;
  capabilities: { voice: boolean; SMS: boolean; MMS: boolean; fax: boolean };
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; numbers: AvailableNumber[] }
  | { kind: 'error'; message: string };

type BuyState =
  | { kind: 'idle' }
  | { kind: 'buying'; phone_number: string }
  | { kind: 'error'; message: string };

export default function Step6Page() {
  const router = useRouter();
  const { draft, patch, status } = useWizard();

  const [tab, setTab] = useState<Tab>('paste');
  const [country, setCountry] = useState('GB');
  const [type, setType] = useState<NumberType>('local');
  const [contains, setContains] = useState('');
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  const [buy, setBuy] = useState<BuyState>({ kind: 'idle' });

  useEffect(() => {
    if (status === 'idle' && !draft) {
      router.replace('/bots/new');
    }
  }, [draft, status, router]);

  if (!draft) {
    return <main className="mx-auto max-w-3xl px-6 py-12 text-slate-500">Loading…</main>;
  }

  const value = draft.twilio_phone_e164 ?? '';
  const looksValid = value === '' || E164_RE.test(value);

  async function handleSearch() {
    setSearch({ kind: 'loading' });
    try {
      const params = new URLSearchParams();
      params.set('country', country);
      params.set('type', type);
      if (contains.trim()) params.set('contains', contains.trim());
      const res = await fetch(`/api/twilio/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setSearch({ kind: 'error', message: scrubProvider(data.error) || 'Search failed' });
        return;
      }
      setSearch({ kind: 'results', numbers: data.numbers ?? [] });
    } catch (e) {
      setSearch({
        kind: 'error',
        message: e instanceof Error ? scrubProvider(e.message) : 'Search failed',
      });
    }
  }

  async function handleBuy(phone_number: string) {
    setBuy({ kind: 'buying', phone_number });
    try {
      const res = await fetch('/api/twilio/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number,
          friendly_name: draft!.internal_name || draft!.business_name || undefined,
          country,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.phone_number) {
        // The proxy already translates common failures, but we still scrub any
        // provider name out of the upstream detail (and hide the detail for
        // 502s where the translated `error` is already user-friendly).
        setBuy({
          kind: 'error',
          message: scrubProvider(data.error) || `HTTP ${res.status}`,
        });
        return;
      }
      patch({ twilio_phone_e164: data.phone_number });
      setBuy({ kind: 'idle' });
      // Remove the just-bought number from the search results.
      setSearch((prev) =>
        prev.kind === 'results'
          ? {
              kind: 'results',
              numbers: prev.numbers.filter((n) => n.phone_number !== phone_number),
            }
          : prev,
      );
    } catch (e) {
      setBuy({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Purchase failed',
      });
    }
  }

  return (
    <StepShell
      step={6}
      total={10}
      title="Phone number"
      description="The number callers dial to reach this AI receptionist."
      backHref="/bots/new/5"
      nextHref="/bots/new/9"
      nextDisabled={!looksValid}
    >
      <div className="space-y-5">
        {value && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <p className="font-medium">
              Current number: <code className="rounded bg-white px-1.5 py-0.5">{value}</code>
            </p>
            <button
              type="button"
              onClick={() => patch({ twilio_phone_e164: null })}
              className="mt-1 text-xs font-medium text-green-700 underline hover:text-green-900"
            >
              Clear and pick a different number
            </button>
          </div>
        )}

        <div className="flex gap-1 border-b border-slate-200">
          <TabButton active={tab === 'paste'} onClick={() => setTab('paste')}>
            Paste existing
          </TabButton>
          <TabButton active={tab === 'buy'} onClick={() => setTab('buy')}>
            Search &amp; buy
          </TabButton>
        </div>

        {tab === 'paste' && (
          <Field
            label="Phone number (E.164)"
            optional
            hint='Paste a number you already own — e.g. "+441173214938". You can skip and add later.'
            htmlFor="phone"
          >
            <input
              id="phone"
              type="tel"
              placeholder="+441234567890"
              value={value}
              onChange={(e) => patch({ twilio_phone_e164: e.target.value || null })}
              className={inputClass}
            />
            {!looksValid && (
              <p className="mt-1 text-xs text-red-600">
                Must start with + and contain 8–15 digits. Example: +441173214938
              </p>
            )}
          </Field>
        )}

        {tab === 'buy' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Country" htmlFor="t_country">
                <select
                  id="t_country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className={inputClass}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type" htmlFor="t_type">
                <select
                  id="t_type"
                  value={type}
                  onChange={(e) => setType(e.target.value as NumberType)}
                  className={inputClass}
                >
                  <option value="local">Local</option>
                  <option value="tollfree">Toll-free</option>
                  <option value="mobile">Mobile</option>
                </select>
              </Field>
              <Field
                label="Contains"
                optional
                htmlFor="t_contains"
                hint="Digits the number must include — e.g. 999."
              >
                <input
                  id="t_contains"
                  type="text"
                  placeholder="999"
                  value={contains}
                  onChange={(e) => setContains(e.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                />
              </Field>
            </div>

            <button
              type="button"
              onClick={handleSearch}
              disabled={search.kind === 'loading'}
              className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {search.kind === 'loading' ? 'Searching…' : 'Search number'}
            </button>

            {search.kind === 'error' && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-medium">Search failed</p>
                <p className="mt-1 text-xs">{search.message}</p>
              </div>
            )}

            {search.kind === 'results' && (
              <div className="rounded-md border border-slate-200">
                {search.numbers.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">
                    <p>No numbers matched.</p>
                    <p className="mt-1 text-xs">
                      Try a different country, change the number type (Local /
                      Toll-free / Mobile), or clear the &quot;Contains&quot; pattern.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {search.numbers.map((n) => {
                      const isBuying =
                        buy.kind === 'buying' && buy.phone_number === n.phone_number;
                      const subParts = [n.locality, n.region, n.iso_country].filter(Boolean);
                      return (
                        <li
                          key={n.phone_number}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-sm">{n.phone_number}</p>
                            <p className="truncate text-xs text-slate-500">
                              {subParts.join(' · ') || n.friendly_name}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleBuy(n.phone_number)}
                            disabled={buy.kind === 'buying'}
                            className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isBuying ? 'Buying…' : 'Buy'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {buy.kind === 'error' && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-medium">Purchase failed</p>
                <p className="mt-1 text-xs">{buy.message}</p>
              </div>
            )}

          </div>
        )}
      </div>
    </StepShell>
  );
}

function scrubProvider(message: string | undefined | null): string {
  if (!message) return '';
  // Belt-and-braces — proxy already sanitises, but if any upstream message
  // sneaks through with a provider name, replace it with a generic phrase.
  return message
    .replace(/\bTwilio\b/gi, 'number search')
    .replace(/\bRetell\s*AI\b/gi, 'voice service')
    .replace(/\bRetell\b/gi, 'voice service');
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? 'border-slate-900 text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
