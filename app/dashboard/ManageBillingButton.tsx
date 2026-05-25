'use client';

import { useState } from 'react';

// Client-side button: POSTs to /api/billing/portal, gets a Stripe Customer
// Portal URL, redirects the browser to it. Used in the SMB dashboard so the
// owner can cancel / update card / view invoices without contacting support.

export function ManageBillingButton({ botId }: { botId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: botId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error || 'Couldn’t open billing portal.');
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline disabled:cursor-wait disabled:text-slate-400"
      >
        {loading ? 'Opening…' : 'Manage billing'}
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
