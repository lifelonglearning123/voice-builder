'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { Field, inputClass } from '@/components/wizard/Field.tsx';
import { Repeater, RemoveButton } from '@/components/wizard/Repeater.tsx';
import { CollapsibleSection } from '@/components/wizard/CollapsibleSection.tsx';
import type { CaptureField, PostCallField } from '@/src/compile/types.ts';

export default function Step9Page() {
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

  function newCaptureField(): CaptureField {
    return { name: '', ask: '', required: true, timing: 'early' };
  }

  function newPostCallField(): PostCallField {
    return { name: '', type: 'text', hint: '' };
  }

  return (
    <StepShell
      step={7}
      total={8}
      title="After the call"
      description="Where the call summary gets sent. Everything else uses smart defaults — open Customise if you want to fine-tune."
      backHref="/bots/new/6"
      nextHref="/bots/new/10"
      nextLabel="Review & deploy →"
    >
      <div className="space-y-3">
        <Field
          label="Summary email"
          hint="Where call summaries get sent after every call."
          htmlFor="summary_email"
        >
          <input
            id="summary_email"
            type="email"
            placeholder="ops@example.com"
            value={draft.fallback_email_to ?? ''}
            onChange={(e) => patch({ fallback_email_to: e.target.value || null })}
            className={inputClass}
          />
        </Field>

        <p className="text-xs text-slate-400">
          Call audio is saved for review, the AI receptionist reads back captured details
          to confirm before ending the call, and a structured summary is generated
          automatically. Transcripts are not kept or sent.
        </p>

        <CollapsibleSection
          title="Customise what's captured"
          count={draft.capture_fields.length + draft.post_call_fields.length}
          preview={previewSummary(
            draft.capture_fields.length,
            draft.post_call_fields.length,
          )}
          defaultOpen={false}
        >
          <div className="space-y-6">
            <Field
              label="Things to ask during the call"
              hint="Specific information the AI receptionist will collect. The AI has prefilled sensible defaults from your description."
            >
              <Repeater<CaptureField>
                items={draft.capture_fields}
                onChange={(next) => patch({ capture_fields: next })}
                newItem={newCaptureField}
                addLabel="Add field"
                emptyLabel="No fields yet."
                render={(item, onChange, onRemove) => (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <input
                      type="text"
                      placeholder='Field name — e.g. "caller_phone"'
                      value={item.name}
                      onChange={(e) => onChange({ ...item, name: e.target.value })}
                      className={inputClass}
                    />
                    <textarea
                      placeholder='Exact question — e.g. "Can I grab a phone number to text the confirmation?"'
                      value={item.ask}
                      onChange={(e) => onChange({ ...item, ask: e.target.value })}
                      rows={2}
                      className={`${inputClass} mt-2`}
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={item.required}
                          onChange={(e) =>
                            onChange({ ...item, required: e.target.checked })
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300"
                        />
                        Required
                      </label>
                      <RemoveButton onClick={onRemove} />
                    </div>
                  </div>
                )}
              />
            </Field>

            <Field
              label="Things to extract after the call"
              hint="What we pull from the transcript and put in the summary email."
            >
              <Repeater<PostCallField>
                items={draft.post_call_fields}
                onChange={(next) => patch({ post_call_fields: next })}
                newItem={newPostCallField}
                addLabel="Add field"
                emptyLabel="No fields yet."
                render={(item, onChange, onRemove) => (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <input
                      type="text"
                      placeholder='Field name — e.g. "caller_intent"'
                      value={item.name}
                      onChange={(e) => onChange({ ...item, name: e.target.value })}
                      className={inputClass}
                    />
                    <textarea
                      placeholder='How to extract — e.g. "Did the caller request a callback? true/false"'
                      value={item.hint}
                      onChange={(e) => onChange({ ...item, hint: e.target.value })}
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
          </div>
        </CollapsibleSection>
      </div>
    </StepShell>
  );
}

function previewSummary(captureCount: number, postCallCount: number): string {
  if (captureCount === 0 && postCallCount === 0) {
    return 'Smart defaults — open to add specific fields.';
  }
  const parts: string[] = [];
  if (captureCount) {
    parts.push(`${captureCount} asked during call`);
  }
  if (postCallCount) {
    parts.push(`${postCallCount} extracted after`);
  }
  return parts.join(' · ');
}
