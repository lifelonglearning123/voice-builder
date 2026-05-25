'use client';

import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Short summary shown when collapsed — e.g. counts or first few items. */
  preview: ReactNode;
  /** Number of items currently in this section. Drives the default open state. */
  count: number;
  /** Override the default: defaults to expanded if empty, collapsed otherwise. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  preview,
  count,
  defaultOpen,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen ?? count === 0);
  const cta = open ? 'Done' : count > 0 ? 'Edit' : 'Add';

  return (
    <section
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow ${
        open ? 'shadow-[0_1px_2px_rgba(15,23,42,0.04)]' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-slate-50/70"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold tracking-tight text-slate-900">
            {title}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{preview}</p>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500 group-hover:text-slate-900">
          {cta}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 pt-4 pb-4">{children}</div>
      )}
    </section>
  );
}
