'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { Field, inputClass } from '@/components/wizard/Field.tsx';

export default function Step5Page() {
  const router = useRouter();
  const { draft, patch, status } = useWizard();

  useEffect(() => {
    if (status === 'idle' && !draft) {
      router.replace('/bots/new');
    }
  }, [draft, status, router]);

  if (!draft) {
    return <main className="mx-auto max-w-3xl px-6 py-12 text-slate-500">Loading…</main>;
  }

  // Single source of truth for the user: monthly budget. The daily cap is
  // derived from it so compileBot's existing hard-stop logic still works.
  const monthly = draft.monthly_minute_cap ?? draft.daily_minute_cap * 30;
  const dailyFromMonthly = Math.max(1, Math.ceil(monthly / 30));
  const dailyEstimate = Math.round(monthly / 30);

  function setMonthly(value: number) {
    const clean = Math.max(0, Math.floor(value));
    patch({
      monthly_minute_cap: clean,
      daily_minute_cap: Math.max(1, Math.ceil(clean / 30)),
    });
  }

  const alertEmail = draft.alert_recipients[0]?.email ?? '';

  function setAlertEmail(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      patch({ alert_recipients: [] });
    } else {
      patch({
        alert_recipients: [{ email: trimmed, channels: ['email'] }],
      });
    }
  }

  return (
    <StepShell
      step={5}
      total={10}
      title="Safety"
      description="A monthly call budget so you'll never get a surprise bill, plus an email to alert when it's close."
      backHref="/bots/new/3"
      nextHref="/bots/new/6"
    >
      <div className="space-y-5">
        <Field
          label="Monthly call budget"
          hint={`The AI receptionist stops accepting new calls once it hits this. Roughly ${dailyEstimate} minutes per day — about ${Math.max(1, Math.floor(dailyEstimate / 2))} two-minute calls.`}
          htmlFor="monthly_budget"
        >
          <div className="flex items-center gap-2">
            <input
              id="monthly_budget"
              type="number"
              min={0}
              step={100}
              value={monthly}
              onChange={(e) => setMonthly(Number(e.target.value))}
              className={`${inputClass} w-32`}
            />
            <span className="text-sm text-slate-500">minutes per month</span>
          </div>
        </Field>

        <Field
          label="Alert email"
          optional
          hint="We'll email here when usage hits 80% of the budget, and again when the budget is reached."
          htmlFor="alert_email"
        >
          <input
            id="alert_email"
            type="email"
            placeholder="ops@example.com"
            value={alertEmail}
            onChange={(e) => setAlertEmail(e.target.value)}
            className={inputClass}
          />
        </Field>

        <p className="text-xs text-slate-400">
          Daily cap derived as {dailyFromMonthly} minutes — the AI receptionist will pause
          new calls until midnight in your timezone when that&apos;s reached.
        </p>
      </div>
    </StepShell>
  );
}
