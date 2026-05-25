'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { Field, inputClass } from '@/components/wizard/Field.tsx';
import type { WorkingHours } from '@/src/compile/types.ts';

const DAYS: Array<{ key: keyof WorkingHours; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
})();

const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'Europe/London', label: 'London (UK)' },
  { value: 'Europe/Dublin', label: 'Dublin (Ireland)' },
  { value: 'Europe/Paris', label: 'Paris (France)' },
  { value: 'Europe/Berlin', label: 'Berlin (Germany)' },
  { value: 'Europe/Madrid', label: 'Madrid (Spain)' },
  { value: 'Europe/Rome', label: 'Rome (Italy)' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam (Netherlands)' },
  { value: 'America/New_York', label: 'New York (US Eastern)' },
  { value: 'America/Chicago', label: 'Chicago (US Central)' },
  { value: 'America/Denver', label: 'Denver (US Mountain)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (US Pacific)' },
  { value: 'Asia/Dubai', label: 'Dubai (UAE)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Tokyo', label: 'Tokyo (Japan)' },
  { value: 'Australia/Sydney', label: 'Sydney (Australia)' },
  { value: 'Pacific/Auckland', label: 'Auckland (New Zealand)' },
];

export default function Step1Page() {
  const router = useRouter();
  const { draft, patch, status } = useWizard();

  // If the wizard loaded but there's no draft, the user landed here directly
  // without going through the entry page — send them back to start.
  useEffect(() => {
    if (status === 'idle' && !draft) {
      router.replace('/bots/new');
    }
  }, [draft, status, router]);

  if (!draft) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 text-slate-500">Loading draft…</main>
    );
  }

  const wh = draft.working_hours;

  function setDay(key: keyof WorkingHours, open: string | null, close: string | null) {
    const next: WorkingHours = { ...wh };
    if (open && close) next[key] = { open, close };
    else next[key] = null;
    patch({ working_hours: next });
  }

  function toggleDay(key: keyof WorkingHours, on: boolean) {
    if (on) setDay(key, '09:00', '17:00');
    else setDay(key, null, null);
  }

  const canContinue = !!draft.business_name.trim();

  return (
    <StepShell
      step={2}
      total={11}
      title="Business basics"
      description="How the AI receptionist identifies itself on a call."
      backHref="/bots/new"
      nextHref="/bots/new/2"
      nextDisabled={!canContinue}
    >
      <div className="space-y-5">
        <Field
          label="Business name (spoken)"
          required
          htmlFor="business_name"
          hint='The AI receptionist will say this — e.g. "Acme Dental".'
        >
          <input
            id="business_name"
            type="text"
            value={draft.business_name}
            onChange={(e) => patch({ business_name: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field
          label="Working hours"
          hint="When your team is available to follow up. Leave a day off to mark it closed."
        >
          <div className="space-y-1.5">
            {DAYS.map(({ key, label }) => {
              const slot = wh[key];
              const isOpen = slot != null;
              return (
                <div key={key} className="flex items-center gap-3">
                  <label className="flex w-20 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isOpen}
                      onChange={(e) => toggleDay(key, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                    />
                    <span className="text-sm font-medium text-slate-700">{label}</span>
                  </label>
                  <TimeSelect
                    value={slot?.open ?? null}
                    disabled={!isOpen}
                    onChange={(v) => slot && setDay(key, v, slot.close)}
                    ariaLabel={`${label} opens at`}
                  />
                  <span className="text-slate-400">–</span>
                  <TimeSelect
                    value={slot?.close ?? null}
                    disabled={!isOpen}
                    onChange={(v) => slot && setDay(key, slot.open, v)}
                    ariaLabel={`${label} closes at`}
                  />
                </div>
              );
            })}
          </div>
        </Field>

        <Field label="Timezone" htmlFor="timezone">
          <select
            id="timezone"
            value={draft.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
            className={inputClass}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
            {!TIMEZONES.some((tz) => tz.value === draft.timezone) &&
              draft.timezone && (
                <option value={draft.timezone}>{draft.timezone}</option>
              )}
          </select>
        </Field>
      </div>
    </StepShell>
  );
}

function TimeSelect({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  // If the stored value isn't on the 15-min grid (e.g. "09:10" from prefill),
  // append it as a one-off option so the select still reflects current state.
  const showCustom = !!value && !TIME_SLOTS.includes(value);
  return (
    <select
      aria-label={ariaLabel}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border-slate-300 px-2 py-1 text-sm shadow-sm disabled:bg-slate-100 disabled:text-slate-400"
    >
      {TIME_SLOTS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      {showCustom && <option value={value!}>{value}</option>}
    </select>
  );
}
