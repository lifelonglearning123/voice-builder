'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWizard } from '@/lib/wizard/context.tsx';
import { StepShell } from '@/components/wizard/StepShell.tsx';
import { Field, inputClass } from '@/components/wizard/Field.tsx';

interface RetellVoice {
  voice_id: string;
  voice_name?: string;
  provider?: string;
  gender?: string;
  accent?: string;
  age?: string;
  preview_audio_url?: string;
}

type GenderFilter = 'all' | 'male' | 'female';

// Only these accents are surfaced to operators. Anything else is hidden from
// both the filter chips AND the voice grid — keeps the catalogue focused on
// the markets we serve.
const ALLOWED_ACCENTS = new Set(['american', 'british', 'english']);

const TONE_CHIPS = [
  'Friendly',
  'Professional',
  'Warm',
  'Brisk',
  'Empathetic',
  'Reassuring',
];

export default function Step2Page() {
  const router = useRouter();
  const { draft, patch, status } = useWizard();

  const [voices, setVoices] = useState<RetellVoice[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [accentFilter, setAccentFilter] = useState<string>('all');
  const [ageFilter, setAgeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (status === 'idle' && !draft) {
      router.replace('/bots/new');
    }
  }, [draft, status, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/retell/voices');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setVoicesError(data.error || `HTTP ${res.status}`);
          return;
        }
        setVoices(data.voices ?? []);
      } catch (e) {
        if (cancelled) return;
        setVoicesError(e instanceof Error ? e.message : 'Failed to load voices');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply the accent allow-list before deriving any filter options or grid
  // contents. Voices without an accent value, or whose accent isn't in
  // ALLOWED_ACCENTS, are hidden entirely.
  const catalogue = useMemo(
    () =>
      (voices ?? []).filter((v) => {
        const accent = v.accent?.toLowerCase();
        return accent && ALLOWED_ACCENTS.has(accent);
      }),
    [voices],
  );

  const accentOptions = useMemo(
    () => uniqueLowercase(catalogue, (v) => v.accent),
    [catalogue],
  );
  const ageOptions = useMemo(
    () => uniqueLowercase(catalogue, (v) => v.age),
    [catalogue],
  );

  const filteredVoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogue.filter((v) => {
      if (genderFilter !== 'all' && v.gender?.toLowerCase() !== genderFilter) return false;
      if (accentFilter !== 'all' && v.accent?.toLowerCase() !== accentFilter) return false;
      if (ageFilter !== 'all' && v.age?.toLowerCase() !== ageFilter) return false;
      if (!q) return true;
      // Exclude provider from the search haystack — we don't surface tech
      // provider names to operators.
      const hay = `${v.voice_name ?? ''} ${v.accent ?? ''} ${v.age ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [catalogue, genderFilter, accentFilter, ageFilter, search]);

  if (!draft) {
    return <main className="mx-auto max-w-3xl px-6 py-12 text-slate-500">Loading…</main>;
  }

  const TONE_CAP = 2;

  function toggleTone(chip: string) {
    const current = draft!.tone_chips;
    if (current.includes(chip)) {
      patch({ tone_chips: current.filter((c) => c !== chip) });
      return;
    }
    const next =
      current.length >= TONE_CAP
        ? [...current.slice(current.length - TONE_CAP + 1), chip]
        : [...current, chip];
    patch({ tone_chips: next });
  }

  const selectedVoice = voices?.find((v) => v.voice_id === draft.voice_id) ?? null;
  const hasVoice = !!selectedVoice;
  const canContinue =
    !!draft.opening_line.trim() && draft.tone_chips.length >= 1 && hasVoice;

  return (
    <StepShell
      step={3}
      total={11}
      title="How it sounds"
      description="Pick a voice, set the tone, and write the opening line."
      backHref="/bots/new/1"
      nextHref="/bots/new/3"
      nextDisabled={!canContinue}
    >
      <div className="space-y-5">
        <Field
          label="Agent name (spoken)"
          optional
          htmlFor="agent_name"
          hint='What the AI receptionist calls itself, e.g. "Sarah", "Emma". Leave blank for "the assistant".'
        >
          <input
            id="agent_name"
            type="text"
            value={draft.agent_name}
            onChange={(e) => patch({ agent_name: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field
          label="Voice"
          required
          hint="Filter by gender, accent, and age. Click Preview to hear each one."
        >
          {voicesError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-medium">Couldn&apos;t load voices</p>
              <p className="mt-1 text-xs">{voicesError}</p>
              <p className="mt-2 text-xs">
                Check your voice-service credentials in{' '}
                <code className="rounded bg-white px-1">.env.local</code>, then refresh.
              </p>
            </div>
          ) : !voices ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-lg border border-slate-200 bg-slate-100"
                />
              ))}
            </div>
          ) : catalogue.length === 0 ? (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              No voices are available yet.
            </p>
          ) : (
            <>
              <div className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <FilterRow
                  label="Gender"
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'female', label: 'Female' },
                    { value: 'male', label: 'Male' },
                  ]}
                  selected={genderFilter}
                  onSelect={(v) => setGenderFilter(v as GenderFilter)}
                />
                {accentOptions.length > 1 && (
                  <FilterRow
                    label="Accent"
                    options={[
                      { value: 'all', label: 'All' },
                      ...accentOptions.map((a) => ({
                        value: a,
                        label: humanizeLabel(a),
                      })),
                    ]}
                    selected={accentFilter}
                    onSelect={setAccentFilter}
                  />
                )}
                {ageOptions.length > 1 && (
                  <FilterRow
                    label="Age"
                    options={[
                      { value: 'all', label: 'All' },
                      ...ageOptions.map((a) => ({
                        value: a,
                        label: humanizeAge(a),
                      })),
                    ]}
                    selected={ageFilter}
                    onSelect={setAgeFilter}
                  />
                )}
                <div className="pt-1">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name…"
                    className="block w-full rounded-md border-slate-300 px-3 py-1.5 text-xs shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                </div>
              </div>

              <div className="max-h-[24rem] overflow-auto rounded-lg border border-slate-200 p-2">
                {filteredVoices.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-slate-500">
                    No voices match these filters.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {filteredVoices.map((v) => (
                      <VoiceCard
                        key={v.voice_id}
                        voice={v}
                        selected={draft.voice_id === v.voice_id}
                        onSelect={() => patch({ voice_id: v.voice_id })}
                      />
                    ))}
                  </div>
                )}
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {selectedVoice
                  ? `Selected: ${selectedVoice.voice_name ?? selectedVoice.voice_id}`
                  : 'Pick a voice — the AI receptionist won’t deploy without one.'}
              </p>
            </>
          )}
        </Field>

        <Field label="Tone" hint="Pick up to 2 — click a third to swap.">
          <div className="flex flex-wrap gap-2">
            {TONE_CHIPS.map((chip) => {
              const active = draft.tone_chips.includes(chip);
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => toggleTone(chip)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:border-slate-500'
                  }`}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label="Opening line"
          required
          htmlFor="opening_line"
          hint="What the AI receptionist says first. One sentence."
        >
          <textarea
            id="opening_line"
            value={draft.opening_line}
            onChange={(e) => patch({ opening_line: e.target.value })}
            rows={2}
            className={inputClass}
          />
        </Field>

        <Field label="Language" htmlFor="language">
          <select
            id="language"
            value={draft.language}
            onChange={(e) =>
              patch({ language: e.target.value as 'en-GB' | 'en-US' })
            }
            className={inputClass}
          >
            <option value="en-GB">UK English</option>
            <option value="en-US">US English</option>
          </select>
        </Field>

        <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">
          The AI receptionist automatically follows: one question at a time · phrase rotation
          (no repeats within 3 turns) · digit-by-digit phone numbers · spelled-out
          emails · phonetic URLs. No setup needed.
        </p>
      </div>
    </StepShell>
  );
}

function VoiceCard({
  voice,
  selected,
  onSelect,
}: {
  voice: RetellVoice;
  selected: boolean;
  onSelect: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = voice.preview_audio_url;

  async function handlePreview(e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    const audio = audioRef.current;
    if (!audio || !previewUrl) {
      setError('No preview available');
      return;
    }

    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      return;
    }

    if (audio.src !== previewUrl) {
      setLoading(true);
      audio.src = previewUrl;
    }

    try {
      await audio.play();
    } catch {
      setLoading(false);
      setError('Preview unavailable');
    }
  }

  // Provider deliberately omitted — operators don't need to see "elevenlabs"
  // or "minimax" on the card.
  const sub = [voice.gender, voice.accent, voice.age]
    .filter((v): v is string => Boolean(v))
    .map(humanizeLabel)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col rounded-lg border p-3 text-left transition ${
        selected
          ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900'
          : 'border-slate-200 hover:border-slate-400'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {voice.voice_name ?? voice.voice_id}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{sub || voice.voice_id}</p>
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={handlePreview}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handlePreview(e as unknown as React.MouseEvent);
            }
          }}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-slate-500 hover:text-slate-900"
        >
          {!previewUrl ? '—' : loading && !playing ? '…' : playing ? '■' : '▶'}
        </span>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          setPlaying(true);
          setLoading(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setLoading(false);
          setPlaying(false);
          setError('Preview unavailable');
        }}
      />
    </button>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onSelect(o.value)}
            aria-pressed={selected === o.value}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              selected === o.value
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function uniqueLowercase<T>(items: T[], pick: (item: T) => string | undefined): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const value = pick(item);
    if (!value) continue;
    set.add(value.toLowerCase());
  }
  return Array.from(set).sort();
}

function humanizeLabel(raw: string): string {
  // "middle_aged" → "Middle aged", "british" → "British"
  return raw
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)([a-z])/g, (_, sep, ch: string) => sep + ch.toUpperCase());
}

function humanizeAge(raw: string): string {
  // Soften the typical Retell age labels into something more presentable.
  const lower = raw.toLowerCase();
  if (lower === 'old' || lower === 'senior') return 'Mature';
  if (lower === 'middle_aged' || lower === 'middleaged') return 'Middle-aged';
  if (lower === 'young' || lower === 'youth') return 'Young';
  if (lower === 'child' || lower === 'kid') return 'Child';
  return humanizeLabel(raw);
}
