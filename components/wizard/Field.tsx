'use client';

import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, htmlFor, required, optional, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
        {optional && <span className="ml-1 text-slate-400">(optional)</span>}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'block w-full rounded-md border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';
