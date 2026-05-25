'use client';

import type { ReactNode } from 'react';

interface RepeaterProps<T> {
  items: T[];
  onChange: (next: T[]) => void;
  newItem: () => T;
  render: (
    item: T,
    onItemChange: (next: T) => void,
    onRemove: () => void,
    index: number,
  ) => ReactNode;
  addLabel: string;
  emptyLabel?: string;
}

export function Repeater<T>({
  items,
  onChange,
  newItem,
  render,
  addLabel,
  emptyLabel,
}: RepeaterProps<T>) {
  return (
    <div className="space-y-3">
      {items.length === 0 && emptyLabel && (
        <p className="text-sm italic text-slate-500">{emptyLabel}</p>
      )}
      {items.map((item, i) => (
        <div key={i}>
          {render(
            item,
            (next) => onChange(items.map((it, j) => (j === i ? next : it))),
            () => onChange(items.filter((_, j) => j !== i)),
            i,
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, newItem()])}
        className="text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        + {addLabel}
      </button>
    </div>
  );
}

export function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium text-slate-500 hover:text-red-600"
    >
      Remove
    </button>
  );
}
