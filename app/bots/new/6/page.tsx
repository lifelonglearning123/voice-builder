'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { wizardStep } from '@/lib/wizard/steps.ts';
import { Field, inputClass } from '@/components/wizard/Field.tsx';

const E164_RE = /^\+\d{8,15}$/;

const COUNTRIES: Array<{ value: string; label: string }> = [
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
];

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
  const { draft, patch, status, agencyId } = useWizard();

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
      if (agencyId) params.set('agency_id', agencyId);
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

  function handleSelect(phone_number: string) {
    // Just record the SMB's chosen number on the draft — we don't actually
    // purchase it from Twilio until *after* the SMB has paid (in the
    // activation flow on step 8). This avoids the agency eating the number
    // rental cost for SMBs who abandon before paying.
    patch({ twilio_phone_e164: phone_number });
    setBuy({ kind: 'idle' });
    setSearch({ kind: 'idle' });
    // Bring the confirmation banner + footer Continue button into view —
    // otherwise the user is stranded mid-list and has to hunt for the CTA.
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return (
    <StepShell
      {...wizardStep('phone')}
      title="Phone number"
      description="The number callers dial to reach this AI receptionist."
      backHref="/bots/new/2"
      nextHref="/bots/new/10"
      nextDisabled={!looksValid}
    >
      <div className="space-y-5">
        {value ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-5">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600 text-white"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.414 0l-3.5-3.5a1 1 0 011.414-1.42L8.5 12.086l6.79-6.795a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-green-900">
                  Number selected
                </p>
                <p className="mt-1 font-mono text-base text-green-900">
                  {value}
                </p>
                <p className="mt-2 text-xs text-green-800">
                  Click <span className="font-medium">Continue</span> below to move on, or pick a different number.
                </p>
                <button
                  type="button"
                  onClick={() => patch({ twilio_phone_e164: null })}
                  className="mt-2 text-xs font-medium text-green-700 underline hover:text-green-900"
                >
                  Clear and pick a different number
                </button>
              </div>
            </div>
          </div>
        ) : (
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

            {search.kind === 'results' && search.numbers.length > 0 && (
              <p className="text-xs text-slate-500">
                Choose the number your customers will call to reach your AI
                receptionist.
              </p>
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
                            onClick={() => handleSelect(n.phone_number)}
                            className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                          >
                            Select
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

