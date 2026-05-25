'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { Field, inputClass } from '@/components/wizard/Field.tsx';
import { Repeater, RemoveButton } from '@/components/wizard/Repeater.tsx';
import { CollapsibleSection } from '@/components/wizard/CollapsibleSection.tsx';
import type {
  EscalationAction,
  EscalationRule,
  FAQ,
  Service,
} from '@/src/compile/types.ts';

// Synthetic UI-only action that maps to the underlying `hard_guardrails` list.
// Everything else maps to `escalation_rules`.
type SensitiveAction = 'refuse_politely' | EscalationAction;

interface SensitiveTopic {
  topic: string;
  action: SensitiveAction;
  detail: string;
}

const SENSITIVE_ACTIONS: Array<{ value: SensitiveAction; label: string }> = [
  { value: 'refuse_politely', label: 'Refuse politely' },
  { value: 'redirect_email', label: 'Redirect to email' },
  { value: 'take_message', label: 'Take a message' },
  { value: 'custom_response', label: 'Speak a custom response' },
];

export default function Step3Page() {
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

  const sensitiveTopics = mergeSensitive(draft.hard_guardrails, draft.escalation_rules);

  function setSensitive(next: SensitiveTopic[]) {
    const { guardrails, escalations } = splitSensitive(next);
    patch({ hard_guardrails: guardrails, escalation_rules: escalations });
  }

  return (
    <StepShell
      step={4}
      total={11}
      title="Review what we drafted"
      description="We've prefilled the AI receptionist's knowledge from your description. Tap a card to review or edit."
      backHref="/bots/new/2"
      nextHref="/bots/new/5"
    >
      <div className="space-y-3">
        <CollapsibleSection
          title="Services"
          count={draft.services.length}
          preview={servicesPreview(draft.services)}
        >
          <Field
            label=""
            hint="The things this business offers. The AI receptionist will refer to these when callers ask."
          >
            <Repeater<Service>
              items={draft.services}
              onChange={(next) => patch({ services: next })}
              newItem={() => ({ name: '', description: '', price: '' })}
              addLabel="Add service"
              emptyLabel="No services yet."
              render={(item, onChange, onRemove) => (
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Name"
                      value={item.name}
                      onChange={(e) => onChange({ ...item, name: e.target.value })}
                      className={inputClass}
                    />
                    <input
                      type="text"
                      placeholder="Price (optional)"
                      value={item.price ?? ''}
                      onChange={(e) =>
                        onChange({ ...item, price: e.target.value || undefined })
                      }
                      className={inputClass}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Short description (optional)"
                    value={item.description ?? ''}
                    onChange={(e) =>
                      onChange({ ...item, description: e.target.value || undefined })
                    }
                    className={`${inputClass} mt-2`}
                  />
                  <div className="mt-2 text-right">
                    <RemoveButton onClick={onRemove} />
                  </div>
                </div>
              )}
            />
          </Field>
        </CollapsibleSection>

        <CollapsibleSection
          title="FAQs"
          count={draft.faqs.length}
          preview={faqsPreview(draft.faqs)}
        >
          <Field
            label=""
            hint="Question/answer pairs. The AI receptionist uses these verbatim when callers ask."
          >
            <Repeater<FAQ>
              items={draft.faqs}
              onChange={(next) => patch({ faqs: next })}
              newItem={() => ({ q: '', a: '' })}
              addLabel="Add FAQ"
              emptyLabel="No FAQs yet."
              render={(item, onChange, onRemove) => (
                <div className="rounded-lg border border-slate-200 p-3">
                  <input
                    type="text"
                    placeholder="Question"
                    value={item.q}
                    onChange={(e) => onChange({ ...item, q: e.target.value })}
                    className={inputClass}
                  />
                  <textarea
                    placeholder="Answer"
                    value={item.a}
                    onChange={(e) => onChange({ ...item, a: e.target.value })}
                    rows={2}
                    className={`${inputClass} mt-2`}
                  />
                  <div className="mt-2 text-right">
                    <RemoveButton onClick={onRemove} />
                  </div>
                </div>
              )}
            />
          </Field>
        </CollapsibleSection>

        <CollapsibleSection
          title="Sensitive topics"
          count={sensitiveTopics.length}
          preview={sensitivePreview(sensitiveTopics)}
        >
          <Field
            label=""
            hint='Topics the AI receptionist should handle carefully — refuse, take a message, or redirect. E.g. "complaint → redirect to mark@example.com".'
          >
            <Repeater<SensitiveTopic>
              items={sensitiveTopics}
              onChange={setSensitive}
              newItem={() => ({ topic: '', action: 'refuse_politely', detail: '' })}
              addLabel="Add topic"
              emptyLabel="No sensitive topics yet."
              render={(item, onChange, onRemove) => (
                <div className="rounded-lg border border-slate-200 p-3">
                  <input
                    type="text"
                    placeholder={topicPlaceholder(item.action)}
                    value={item.topic}
                    onChange={(e) => onChange({ ...item, topic: e.target.value })}
                    className={inputClass}
                  />
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <select
                      value={item.action}
                      onChange={(e) =>
                        onChange({
                          ...item,
                          action: e.target.value as SensitiveAction,
                        })
                      }
                      className={inputClass}
                    >
                      {SENSITIVE_ACTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {item.action !== 'refuse_politely' && (
                      <input
                        type="text"
                        placeholder={detailPlaceholder(item.action)}
                        value={item.detail}
                        onChange={(e) =>
                          onChange({ ...item, detail: e.target.value })
                        }
                        className={`${inputClass} col-span-2`}
                      />
                    )}
                  </div>
                  <div className="mt-2 text-right">
                    <RemoveButton onClick={onRemove} />
                  </div>
                </div>
              )}
            />
          </Field>
        </CollapsibleSection>
      </div>
    </StepShell>
  );
}

/* ---------------------------------------------------------------------------
 * Helpers — preview text per section
 * ------------------------------------------------------------------------- */

function servicesPreview(items: Service[]): string {
  if (items.length === 0) return 'None yet — tap to add the things this business offers.';
  const names = items.map((s) => s.name || 'Unnamed').filter((n) => n.trim());
  const head = names.slice(0, 4).join(' · ');
  const extra = names.length > 4 ? ` · +${names.length - 4} more` : '';
  return `${head}${extra}`;
}

function faqsPreview(items: FAQ[]): string {
  if (items.length === 0) return 'None yet — tap to add answers to common questions.';
  return `${items.length} prepared`;
}

function sensitivePreview(items: SensitiveTopic[]): string {
  if (items.length === 0) {
    return 'None yet — add topics the receptionist must refuse or escalate.';
  }
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.action] = (counts[item.action] ?? 0) + 1;
  }
  const parts = SENSITIVE_ACTIONS.flatMap((a) => {
    const n = counts[a.value] ?? 0;
    if (!n) return [];
    return [`${n} ${a.label.toLowerCase()}`];
  });
  return parts.join(' · ');
}

function topicPlaceholder(action: SensitiveAction): string {
  if (action === 'refuse_politely') {
    return 'What the AI receptionist must not do — e.g. "Do not give medical advice"';
  }
  return 'Trigger — e.g. "complaint"';
}

function detailPlaceholder(action: SensitiveAction): string {
  switch (action) {
    case 'refuse_politely':
      return '';
    case 'redirect_email':
      return 'Email address';
    case 'take_message':
      return 'Optional: what to say while taking the message';
    case 'custom_response':
      return 'What the AI receptionist should say';
    default:
      // 'transfer_number' has been removed as an option; legacy rules are
      // scrubbed at the boundary in `ensureWizardShape`, but a fallback keeps
      // the switch exhaustive against the underlying `EscalationAction` type.
      return '';
  }
}

/* ---------------------------------------------------------------------------
 * Boundary conversion — unified UI list ↔ underlying split data model
 * ------------------------------------------------------------------------- */

function mergeSensitive(
  guardrails: string[],
  escalations: EscalationRule[],
): SensitiveTopic[] {
  const out: SensitiveTopic[] = [];
  for (const g of guardrails) {
    out.push({ topic: g, action: 'refuse_politely', detail: '' });
  }
  for (const e of escalations) {
    out.push({ topic: e.trigger, action: e.action, detail: e.detail });
  }
  return out;
}

function splitSensitive(items: SensitiveTopic[]): {
  guardrails: string[];
  escalations: EscalationRule[];
} {
  const guardrails: string[] = [];
  const escalations: EscalationRule[] = [];
  for (const item of items) {
    if (item.action === 'refuse_politely') {
      guardrails.push(item.topic);
    } else {
      escalations.push({
        trigger: item.topic,
        action: item.action,
        detail: item.detail,
      });
    }
  }
  return { guardrails, escalations };
}
