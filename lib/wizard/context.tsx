'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PrefilledBot } from '@/src/prefill/types.ts';
import type { AlertRecipient, CrmStatus } from '@/src/compile/types.ts';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

// PrefilledBot is what the AI generates. WizardDraft adds the operator-only
// fields the wizard captures in later steps.
export interface WizardDraft extends PrefilledBot {
  transfer_number: string | null;
  monthly_minute_cap: number | null;
  alert_recipients: AlertRecipient[];
  twilio_phone_e164: string | null;
  crm_status: CrmStatus;
  crm_location_id: string | null;
  crm_location_name: string | null;
  crm_token: string | null;
  booking_calendar_id: string | null;
  crm_workflow_id: string | null;
  fallback_email_to: string | null;
  fallback_email_template: string | null;
}

const WIZARD_DEFAULTS: Pick<
  WizardDraft,
  | 'transfer_number'
  | 'monthly_minute_cap'
  | 'alert_recipients'
  | 'twilio_phone_e164'
  | 'crm_status'
  | 'crm_location_id'
  | 'crm_location_name'
  | 'crm_token'
  | 'booking_calendar_id'
  | 'crm_workflow_id'
  | 'fallback_email_to'
  | 'fallback_email_template'
> = {
  transfer_number: null,
  monthly_minute_cap: null,
  alert_recipients: [],
  twilio_phone_e164: null,
  crm_status: 'not_connected',
  crm_location_id: null,
  crm_location_name: null,
  crm_token: null,
  booking_calendar_id: null,
  crm_workflow_id: null,
  fallback_email_to: null,
  fallback_email_template: null,
};

// Normalise a raw draft into the current shape. Also locks in fields that
// are no longer user-controllable (transfer/CRM/booking removed, transcripts
// off, etc.) so the AI prefill or stale rows can't bring them back.
export function ensureWizardShape(
  raw: PrefilledBot | Partial<WizardDraft>,
): WizardDraft {
  const merged = {
    ...WIZARD_DEFAULTS,
    ...(raw as WizardDraft),
  };
  if (!Array.isArray(merged.custom_tools)) merged.custom_tools = [];
  if (!Array.isArray(merged.reason_branches)) merged.reason_branches = [];
  merged.transfer_enabled = false;
  merged.crm_status = 'skipped';
  merged.booking_enabled = false;
  if (Array.isArray(merged.escalation_rules)) {
    merged.escalation_rules = merged.escalation_rules.filter(
      (r) => r.action !== 'transfer_number',
    );
  }
  merged.verify_capture_before_close = true;
  merged.save_audio = true;
  merged.save_transcript = false;
  merged.reason_branches = [];
  return merged;
}

type Status = 'loading' | 'idle' | 'saving' | 'error' | 'no_agency';

type BotLifecycle = 'draft' | 'live' | 'archived' | null;

interface WizardState {
  draft: WizardDraft | null;
  /** Database id of the in-progress bot row. Null until first save. */
  botId: string | null;
  /** The agency this user is acting on behalf of. Required for any save. */
  agencyId: string | null;
  /** Lifecycle status of the loaded bot — null if no bot loaded. */
  botStatus: BotLifecycle;
  /** UI state for the persistence layer. */
  status: Status;
  setDraft: (next: PrefilledBot | WizardDraft | null) => void;
  patch: (partial: Partial<WizardDraft>) => void;
  /** Discard the in-progress draft (deletes the DB row if status='draft'). */
  reset: () => Promise<void>;
  /** Called from the Activate step after a successful deploy. */
  markActivated: (data: {
    agent_id: string;
    llm_id: string;
    phone_e164?: string | null;
  }) => Promise<void>;
}

const WizardContext = createContext<WizardState | null>(null);

export function WizardProvider({ children, initialAgencyId = null }: { children: ReactNode; initialAgencyId?: string | null }) {
  const [draft, setDraftState] = useState<WizardDraft | null>(null);
  const [botId, setBotId] = useState<string | null>(null);
  const [botStatus, setBotStatus] = useState<BotLifecycle>(null);
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  // Single Supabase client for the provider's lifetime.
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Refs to avoid stale closures inside the debounce / chained-save logic.
  const botIdRef = useRef<string | null>(null);
  const agencyIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    botIdRef.current = botId;
  }, [botId]);
  useEffect(() => {
    agencyIdRef.current = agencyId;
  }, [agencyId]);

  // ---------------------------------------------------------------------------
  // On-mount: resolve the user's agency + load their in-progress draft if any
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          // Middleware should have redirected; treat as idle so UI doesn't hang.
          setStatus('idle');
          return;
        }

        // Determine which agency to act on behalf of.
        // initialAgencyId is resolved server-side from the request hostname so
        // users who belong to multiple agencies always land on the right one.
        // Fall back to membership query only when the layout couldn't resolve it.
        let resolved: string | null = initialAgencyId;
        if (!resolved) {
          const [{ data: staffRows }, { data: clientRows }] = await Promise.all([
            supabase
              .from('agency_members')
              .select('agency_id')
              .eq('user_id', user.id)
              .limit(1),
            supabase
              .from('agency_clients')
              .select('agency_id')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(1),
          ]);
          if (cancelled) return;
          resolved = staffRows?.[0]?.agency_id ?? clientRows?.[0]?.agency_id ?? null;
        }
        setAgencyId(resolved);

        if (!resolved) {
          // User is signed in but isn't a member of any agency yet. They can
          // sign in but can't save bots — surfaced in the UI as a soft block.
          setStatus('no_agency');
          return;
        }

        // If the URL has ?bot=<id>, load THAT specific bot regardless of
        // status (e.g. when the user clicks "Edit" on a live bot from the
        // dashboard). Otherwise, fall back to the most recent draft.
        const requestedBotId =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('bot')
            : null;

        const query = requestedBotId
          ? supabase
              .from('bots')
              .select('id, draft, status')
              .eq('owner_user_id', user.id)
              .eq('id', requestedBotId)
              .maybeSingle()
          : supabase
              .from('bots')
              .select('id, draft, status')
              .eq('owner_user_id', user.id)
              .eq('status', 'draft')
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

        const { data: bot } = await query;
        if (cancelled) return;

        if (bot) {
          setBotId(bot.id);
          setBotStatus(bot.status as BotLifecycle);
          setDraftState(ensureWizardShape(bot.draft as Partial<WizardDraft>));
        }
        setStatus('idle');
      } catch (e) {
        console.error('wizard load failed:', e);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // supabase is memoised; initialAgencyId comes from a server prop and never
    // changes after mount. Intentionally empty dep array — runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Persistence — debounced auto-save, chained to avoid races
  // ---------------------------------------------------------------------------

  const saveNow = useCallback(
    async (d: WizardDraft) => {
      const aid = agencyIdRef.current;
      if (!aid) {
        // No agency → can't persist. Mark as error so the UI can surface it.
        setStatus('no_agency');
        return;
      }
      const prev = inflightRef.current ?? Promise.resolve();
      const next = prev
        .then(async () => {
          setStatus('saving');
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            setStatus('idle');
            return;
          }
          // Backfill the post-call summary email to the signed-in user's
          // address. The wizard no longer exposes a UI to edit this, so we
          // default it on every save — also catches older draft rows that
          // were saved before this default existed.
          const draftToSave: WizardDraft = d.fallback_email_to
            ? d
            : { ...d, fallback_email_to: user.email ?? null };
          if (botIdRef.current) {
            const { error } = await supabase
              .from('bots')
              .update({ draft: draftToSave })
              .eq('id', botIdRef.current);
            if (error) throw error;
          } else {
            const { data: inserted, error } = await supabase
              .from('bots')
              .insert({
                agency_id: aid,
                user_id: user.id,
                owner_user_id: user.id,
                draft: draftToSave,
                status: 'draft',
              })
              .select('id')
              .single();
            if (error) throw error;
            setBotId(inserted.id);
          }
          setStatus('idle');
        })
        .catch((e) => {
          console.error('wizard save failed:', e);
          setStatus('error');
        });
      inflightRef.current = next;
      await next;
    },
    [supabase],
  );

  const scheduleSave = useCallback(
    (d: WizardDraft) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void saveNow(d);
      }, 600);
    },
    [saveNow],
  );

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const setDraft = useCallback(
    (next: PrefilledBot | WizardDraft | null) => {
      if (!next) {
        setDraftState(null);
        return;
      }
      const shaped = ensureWizardShape(next);
      setDraftState(shaped);
      scheduleSave(shaped);
    },
    [scheduleSave],
  );

  const patch = useCallback(
    (partial: Partial<WizardDraft>) => {
      setDraftState((prev) => {
        if (!prev) return prev;
        const merged = { ...prev, ...partial };
        scheduleSave(merged);
        return merged;
      });
    },
    [scheduleSave],
  );

  const reset = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const id = botIdRef.current;
    if (id) {
      try {
        await supabase.from('bots').delete().eq('id', id).eq('status', 'draft');
      } catch (e) {
        console.error('wizard reset failed:', e);
      }
    }
    setDraftState(null);
    setBotId(null);
  }, [supabase]);

  const markActivated = useCallback(
    async (data: {
      agent_id: string;
      llm_id: string;
      phone_e164?: string | null;
    }) => {
      const id = botIdRef.current;
      if (!id) return;
      // Cancel any pending draft save — we're about to flip status.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Wait for any in-flight save to settle first.
      await inflightRef.current;
      try {
        await supabase
          .from('bots')
          .update({
            status: 'live',
            agent_id: data.agent_id,
            llm_id: data.llm_id,
            phone_e164: data.phone_e164 ?? draft?.twilio_phone_e164 ?? null,
          })
          .eq('id', id);
      } catch (e) {
        console.error('markActivated failed:', e);
      }
    },
    [supabase, draft],
  );

  const value = useMemo<WizardState>(
    () => ({
      draft,
      botId,
      botStatus,
      agencyId,
      status,
      setDraft,
      patch,
      reset,
      markActivated,
    }),
    [draft, botId, botStatus, agencyId, status, setDraft, patch, reset, markActivated],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardState {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used inside <WizardProvider>');
  return ctx;
}
