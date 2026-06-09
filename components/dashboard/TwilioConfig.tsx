'use client';

import { useEffect, useState, useCallback } from 'react';

// Only countries where Twilio requires a regulatory bundle + address SID
// before a number can be purchased. US and CA have no such requirement.
const REGULATED_COUNTRIES = [
  { code: 'GB', label: 'United Kingdom' },
];
const NUMBER_TYPES = ['LOCAL', 'MOBILE', 'TOLLFREE'];

interface Bundle { sid: string; friendly_name: string; status: string }
interface Address { sid: string; friendly_name: string; street: string; city: string; iso_country: string }
type RegulatoryConfig = Record<string, Record<string, { bundle_sid?: string | null; address_sid?: string | null }>>;

interface TwilioData {
  account_sid: string | null;
  auth_token_set: boolean;
  auth_token_hint: string | null;
  regulatory: RegulatoryConfig;
}

export function TwilioConfig({ agencyId }: { agencyId: string }) {
  const [data, setData] = useState<TwilioData | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [regulatory, setRegulatory] = useState<RegulatoryConfig>({});

  const [credStatus, setCredStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [regStatus, setRegStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [credError, setCredError] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/agency/twilio?agency_id=${agencyId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const d = json as TwilioData;
      setData(d);
      setAccountSid(d.account_sid ?? '');
      setRegulatory(d.regulatory ?? {});
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load Twilio settings.');
    }
  }, [agencyId]);

  const loadBundlesAndAddresses = useCallback(async () => {
    const [bRes, aRes] = await Promise.all([
      fetch(`/api/agency/twilio/bundles?agency_id=${agencyId}`),
      fetch(`/api/agency/twilio/addresses?agency_id=${agencyId}`),
    ]);
    if (bRes.ok) {
      const j = await bRes.json();
      setBundles(j.bundles ?? []);
    }
    if (aRes.ok) {
      const j = await aRes.json();
      setAddresses(j.addresses ?? []);
    }
  }, [agencyId]);

  useEffect(() => {
    void loadConfig();
    void loadBundlesAndAddresses();
  }, [loadConfig, loadBundlesAndAddresses]);

  async function saveCredentials() {
    setCredStatus('saving');
    setCredError(null);
    try {
      const body: Record<string, unknown> = { agency_id: agencyId, account_sid: accountSid || null };
      if (authToken) body.auth_token = authToken;
      const res = await fetch('/api/agency/twilio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setCredStatus('saved');
      setAuthToken('');
      await loadConfig();
      await loadBundlesAndAddresses();
      setTimeout(() => setCredStatus('idle'), 3000);
    } catch (e) {
      setCredError(e instanceof Error ? e.message : 'Failed to save.');
      setCredStatus('error');
    }
  }

  async function saveRegulatory() {
    setRegStatus('saving');
    setRegError(null);
    try {
      const res = await fetch('/api/agency/twilio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency_id: agencyId, regulatory }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setRegStatus('saved');
      setTimeout(() => setRegStatus('idle'), 3000);
    } catch (e) {
      setRegError(e instanceof Error ? e.message : 'Failed to save.');
      setRegStatus('error');
    }
  }

  function setReg(country: string, type: string, field: 'bundle_sid' | 'address_sid', value: string) {
    setRegulatory((prev) => ({
      ...prev,
      [country]: {
        ...(prev[country] ?? {}),
        [type]: {
          ...(prev[country]?.[type] ?? {}),
          [field]: value || null,
        },
      },
    }));
  }

  if (loadError) {
    return (
      <p className="mt-4 text-sm text-red-600">{loadError}</p>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      {/* Credentials */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700" htmlFor="twilio-sid">
            Account SID
          </label>
          <input
            id="twilio-sid"
            type="text"
            value={accountSid}
            onChange={(e) => setAccountSid(e.target.value)}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700" htmlFor="twilio-token">
            Auth Token
            {data?.auth_token_set && (
              <span className="ml-2 text-slate-400">
                (currently: {data.auth_token_hint})
              </span>
            )}
          </label>
          <input
            id="twilio-token"
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={data?.auth_token_set ? 'Leave blank to keep existing token' : 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-500 focus:outline-none"
          />
        </div>
        {!accountSid && !authToken && (
          <p className="text-xs text-slate-400">
            Leave both blank to use the platform Twilio account.
          </p>
        )}
        {credError && <p className="text-xs text-red-600">{credError}</p>}
        <button
          type="button"
          onClick={saveCredentials}
          disabled={credStatus === 'saving'}
          className="wizard-pill text-sm"
        >
          {credStatus === 'saving' ? 'Saving…' : credStatus === 'saved' ? 'Saved ✓' : 'Save credentials'}
        </button>
      </div>

      {/* Regulatory bundles + addresses — only shown once a Twilio account is saved */}
      {data?.account_sid && <div>
        <p className="text-xs font-medium text-slate-700">
          Regulatory bundles &amp; addresses
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Required for UK numbers only — Twilio enforces proof of local presence before
          a UK geographic or mobile number can be purchased. US and Canada have no such
          requirement. Leave blank to use the platform defaults.
        </p>

        {bundles.length === 0 && addresses.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            No bundles or addresses found. Save your Twilio credentials above to load them.
          </p>
        ) : (
          <div className="mt-4 space-y-6">
            {REGULATED_COUNTRIES.map((c) => (
              <div key={c.code}>
                <p className="text-xs font-semibold text-slate-800">{c.label} ({c.code})</p>
                <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {NUMBER_TYPES.map((type) => (
                    <div key={type} className="grid grid-cols-3 gap-3 px-4 py-3">
                      <span className="text-xs font-medium text-slate-600 self-center">
                        {type.charAt(0) + type.slice(1).toLowerCase()}
                      </span>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">Bundle</label>
                        <select
                          value={regulatory[c.code]?.[type]?.bundle_sid ?? ''}
                          onChange={(e) => setReg(c.code, type, 'bundle_sid', e.target.value)}
                          className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none"
                        >
                          <option value="">(none)</option>
                          {bundles.map((b) => (
                            <option key={b.sid} value={b.sid}>
                              {b.friendly_name} — {b.sid.slice(-8)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">Address</label>
                        <select
                          value={regulatory[c.code]?.[type]?.address_sid ?? ''}
                          onChange={(e) => setReg(c.code, type, 'address_sid', e.target.value)}
                          className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none"
                        >
                          <option value="">(none)</option>
                          {addresses
                            .filter((a) => a.iso_country === c.code)
                            .map((a) => (
                              <option key={a.sid} value={a.sid}>
                                {a.friendly_name || `${a.street}, ${a.city}`} — {a.sid.slice(-8)}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {regError && <p className="mt-3 text-xs text-red-600">{regError}</p>}
        {bundles.length > 0 || addresses.length > 0 ? (
          <button
            type="button"
            onClick={saveRegulatory}
            disabled={regStatus === 'saving'}
            className="mt-4 wizard-pill text-sm"
          >
            {regStatus === 'saving' ? 'Saving…' : regStatus === 'saved' ? 'Saved ✓' : 'Save regulatory settings'}
          </button>
        ) : null}
      </div>}
    </div>
  );
}
