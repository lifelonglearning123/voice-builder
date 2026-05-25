'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

interface Props {
  step: number;
  total: number;
  title: string;
  description?: string;
  backHref?: string;
  nextHref?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  onContinue?: () => boolean | void;
  children: ReactNode;
}

const TOTAL_STEPS = 8;

export function StepShell({
  step,
  total = TOTAL_STEPS,
  title,
  description,
  backHref,
  nextHref,
  nextLabel = 'Continue →',
  nextDisabled,
  onContinue,
  children,
}: Props) {
  const router = useRouter();
  const progress = step / total;

  function handleContinue() {
    const ok = onContinue ? onContinue() : true;
    if (ok !== false && nextHref) router.push(nextHref);
  }

  return (
    <>
      {/* Progress rail — matches the entry page */}
      <div className="fixed inset-x-0 top-0 z-10 bg-[color:var(--wizard-canvas)]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <span className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
            VOICE BUILDER
          </span>
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono-tight text-[11px] tracking-[0.2em] uppercase text-slate-400">
              Step
            </span>
            <span className="font-mono-tight text-[16px] font-semibold tracking-tight tabular-nums text-slate-900">
              {String(step).padStart(2, '0')}
            </span>
            <span className="font-mono-tight text-[13px] tracking-[0.18em] uppercase text-slate-400">
              of
            </span>
            <span className="font-mono-tight text-[16px] font-semibold tracking-tight tabular-nums text-slate-900">
              {String(total).padStart(2, '0')}
            </span>
          </div>
        </div>
        <div className="relative h-[3px] bg-slate-200/70">
          <div
            className="wizard-rail-bar absolute inset-y-0 left-0 right-0 origin-left rounded-r-full bg-slate-900"
            style={{ ['--rail-progress' as string]: progress }}
          />
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-6 pt-24 pb-24 md:pt-28">
        <nav className="mb-8 text-sm">
          {backHref ? (
            <Link
              href={backHref as never}
              className="text-slate-400 transition-colors hover:text-slate-900"
            >
              ← Back
            </Link>
          ) : (
            <Link
              href="/"
              className="text-slate-400 transition-colors hover:text-slate-900"
            >
              ← Home
            </Link>
          )}
        </nav>

        <header className="mb-10 wizard-fade-up">
          <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
            STEP {String(step).padStart(2, '0')}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-900 md:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-500 md:text-lg">
              {description}
            </p>
          )}
        </header>

        <div
          className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:p-8 wizard-fade-up"
          style={{ animationDelay: '80ms' }}
        >
          {children}
        </div>

        <div className="mt-8 flex items-center justify-between">
          {backHref ? (
            <Link
              href={backHref as never}
              className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              ← Back
            </Link>
          ) : (
            <span />
          )}
          {nextHref && (
            <button
              type="button"
              onClick={handleContinue}
              disabled={nextDisabled}
              className="wizard-pill"
            >
              {nextLabel}
            </button>
          )}
        </div>
      </main>
    </>
  );
}
