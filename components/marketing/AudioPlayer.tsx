'use client';

import { useEffect, useRef, useState } from 'react';

// Hero audio player. Three tabbed sample calls (different industries), an
// animated waveform that pulses while playing, and a big circular play button.
// No external dependencies — just <audio> + CSS.
//
// Drop the actual MP3s into `public/voice-samples/marketing/` and update the
// `samples` prop with their paths.

export interface AudioSample {
  id: string;
  label: string;
  /** One-line scene description shown under the tab. */
  description: string;
  src: string;
  /** Optional pre-set duration label (e.g. "1:24"). Read from <audio> otherwise. */
  duration?: string;
}

interface AudioPlayerProps {
  samples: AudioSample[];
  /** Optional accent override (defaults to the page's --agency-accent). */
  accent?: string;
}

export function AudioPlayer({ samples, accent }: AudioPlayerProps) {
  const [activeId, setActiveId] = useState(samples[0]?.id ?? '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [duration, setDuration] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const active = samples.find((s) => s.id === activeId) ?? samples[0];

  // Reset playback when switching tabs.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
    setIsPlaying(false);
    setProgress(0);
  }, [activeId]);

  // Wire time/duration updates.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (a.duration > 0) setProgress(a.currentTime / a.duration);
    };
    const onLoaded = () => setDuration(a.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('ended', onEnded);
    };
  }, [activeId]);

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      setIsPlaying(false);
    } else {
      a.play().catch(() => {
        /* Autoplay blocked or file missing — silent fail, button resets. */
        setIsPlaying(false);
      });
      setIsPlaying(true);
    }
  }

  const accentStyle = accent ? ({ ['--agency-accent' as string]: accent } as React.CSSProperties) : undefined;

  return (
    <div
      className="relative overflow-hidden rounded-[28px] border border-slate-900/8 bg-white p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_60px_rgba(15,23,42,0.08)]"
      style={accentStyle}
    >
      {/* Top tab bar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-full bg-slate-100/80 p-1">
        {samples.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveId(s.id)}
              className={
                'rounded-full px-4 py-1.5 text-xs font-medium tracking-tight transition-all ' +
                (isActive
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900')
              }
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Scene caption */}
      <p className="mt-5 text-sm tracking-tight text-slate-600">
        {active?.description}
      </p>

      {/* Player row */}
      <div className={`mt-5 flex items-center gap-5 ${isPlaying ? 'is-playing' : ''}`}>
        {/* Play button */}
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play sample'}
          className="group relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition-transform hover:scale-[1.03] focus:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(var(--agency-accent-rgb),0.25)]"
          style={{
            boxShadow:
              '0 1px 2px rgba(15,23,42,0.1), 0 12px 32px rgba(var(--agency-accent-rgb), 0.35)',
          }}
        >
          {isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {/* Pulse ring while playing */}
          {isPlaying && (
            <span
              className="pointer-events-none absolute inset-0 -z-10 animate-ping rounded-full"
              style={{
                background: 'rgba(var(--agency-accent-rgb), 0.25)',
                animationDuration: '1.6s',
              }}
            />
          )}
        </button>

        {/* Waveform bars */}
        <div className="flex h-12 flex-1 items-center gap-[3px]">
          {WAVEFORM_HEIGHTS.map((h, i) => (
            <span
              key={i}
              className="waveform-bar"
              style={{
                height: `${h}%`,
                opacity:
                  // Fade bars past the current progress slightly so it feels
                  // like a real waveform scrubber.
                  i / WAVEFORM_HEIGHTS.length <= progress ? 1 : 0.35,
              }}
            />
          ))}
        </div>

        {/* Time readout */}
        <div className="hidden font-mono-tight text-xs tabular-nums text-slate-500 sm:block">
          {formatTime(progress * (duration ?? 0))} /{' '}
          {active?.duration ?? (duration ? formatTime(duration) : '—:—')}
        </div>
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} src={active?.src} preload="metadata" />

      {/* Footer hint */}
      <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-slate-400">
        Real AI receptionist · No human in the loop
      </p>
    </div>
  );
}

// Pre-baked waveform heights (percent). Looks like a real recording — busy in
// the middle, quieter at the ends. Forty-eight bars feel about right at the
// hero size; on mobile they squish naturally via flex.
const WAVEFORM_HEIGHTS = [
  18, 24, 32, 28, 40, 52, 64, 58, 70, 82, 76, 90, 85, 72, 64, 78, 86, 92, 80, 68,
  74, 88, 76, 60, 54, 68, 80, 72, 64, 76, 82, 68, 56, 48, 60, 72, 80, 64, 52, 42,
  48, 56, 44, 38, 32, 26, 22, 18,
];

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
