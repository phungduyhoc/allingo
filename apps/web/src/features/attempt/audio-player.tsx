'use client';

import * as React from 'react';
import { Pause, Play, Repeat, RotateCcw, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@allingo/ui';

export const PLAYBACK_RATES = [0.75, 1, 1.25] as const;
export const SEEK_STEP_SEC = 5;

export interface AudioPlayerProps {
  src: string;
  /** Nhãn cho trình đọc màn hình (Audio câu 3 / Hội thoại 1…) */
  label?: string;
  /** Gọn (audio câu hỏi Part 3–4): ẩn tốc độ/lặp */
  compact?: boolean;
  /** Vị trí phát (ms) – tô sáng transcript ở Review */
  onTime?: (ms: number) => void;
  onStarted?: () => void;
  /** URL lỗi (403 hết hạn…) → cha gia hạn rồi truyền `src` mới; gọi tối đa một lần cho mỗi src */
  onError?: () => void;
  className?: string;
  'data-testid'?: string;
}

const fmt = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Trình phát tự do cho Practice/drill và Xem lại (`listen_policy = 'free'`): phát/tạm dừng, thanh tua + ←/→ 5 s, tốc độ
 * 0,75/1/1,25, lặp. Exam Mode "nghe một lần" KHÔNG dùng component này (chuỗi phát ở `listening/`).
 * Đổi `src` (URL gia hạn): đang phát → đổi khi tạm dừng/hết/lỗi; không phát → đổi ngay, giữ vị trí.
 */
export function AudioPlayer({ src, label, compact = false, onTime, onStarted, onError, className, 'data-testid': testId = 'audio-player' }: AudioPlayerProps) {
  const t = useTranslations('attempt');
  const ref = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [rate, setRate] = React.useState<number>(1);
  const [loop, setLoop] = React.useState(false);
  const startedRef = React.useRef(false);
  const appliedRef = React.useRef<string | null>(null);
  const pendingRef = React.useRef<string | null>(null);
  const restoreRef = React.useRef<{ time: number; play: boolean } | null>(null);
  const erroredSrcRef = React.useRef<string | null>(null);

  // Gán src bằng mã (không qua thuộc tính React) để giữ vị trí khi đổi URL gia hạn
  const apply = React.useCallback((url: string, play: boolean) => {
    const el = ref.current;
    if (!el) return;
    if (appliedRef.current && el.currentTime > 0) restoreRef.current = { time: el.currentTime, play };
    appliedRef.current = url;
    pendingRef.current = null;
    el.src = url;
  }, []);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || appliedRef.current === src) return;
    // Đang phát → đổi khi dừng/hết/lỗi (URL cũ vẫn còn hạn ≥ 2′ – không cắt ngang đoạn đang nghe)
    if (appliedRef.current && !el.paused && !el.ended) pendingRef.current = src;
    else apply(src, false);
  }, [apply, src]);
  const swapIfPending = () => {
    if (pendingRef.current) apply(pendingRef.current, false);
  };

  const seekTo = (sec: number) => {
    const el = ref.current;
    if (!el) return;
    const max = Number.isFinite(el.duration) ? el.duration : sec;
    el.currentTime = Math.max(0, Math.min(max, sec));
    setCurrent(el.currentTime);
  };

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused || el.ended) void el.play().catch(() => undefined);
    else el.pause();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // ←/→ tua 5 s khi focus trong trình phát; chặn phím chuyển câu của màn làm bài (kiểm tra defaultPrevented)
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (el) seekTo(el.currentTime + (e.key === 'ArrowRight' ? SEEK_STEP_SEC : -SEEK_STEP_SEC));
  };

  return (
    <div
      className={cn('rounded-xl border border-border bg-card p-2.5', className)}
      data-testid={testId}
      data-policy="free"
      data-playing={playing}
      role="group"
      aria-label={label ?? t('audioLabel')}
      onKeyDown={onKeyDown}
    >
      <audio
        ref={ref}
        preload="metadata"
        loop={loop}
        aria-label={label ?? t('audioLabel')}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(Number.isFinite(el.duration) ? el.duration : 0);
          el.playbackRate = rate;
          const r = restoreRef.current;
          restoreRef.current = null;
          if (r) {
            el.currentTime = Math.min(r.time, Number.isFinite(el.duration) ? el.duration : r.time);
            if (r.play) void el.play().catch(() => undefined);
          }
        }}
        onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onPlay={() => {
          setPlaying(true);
          if (!startedRef.current) {
            startedRef.current = true;
            onStarted?.();
          }
        }}
        onPause={() => {
          setPlaying(false);
          swapIfPending();
        }}
        onEnded={() => {
          setPlaying(false);
          swapIfPending();
        }}
        onTimeUpdate={(e) => {
          setCurrent(e.currentTarget.currentTime);
          onTime?.(e.currentTarget.currentTime * 1000);
        }}
        onError={() => {
          setPlaying(false);
          if (pendingRef.current) {
            apply(pendingRef.current, false);
            return;
          }
          // Mỗi URL chỉ báo lỗi một lần (tránh vòng lặp gia hạn khi tệp hỏng thật)
          if (!appliedRef.current || erroredSrcRef.current === appliedRef.current) return;
          erroredSrcRef.current = appliedRef.current;
          onError?.();
        }}
      />
      <div className="flex items-center gap-2">
        <Button type="button" variant="navy" size="icon" className="size-9 shrink-0 rounded-full" onClick={toggle} aria-label={playing ? t('audioPause') : t('audioPlay')} data-testid="player-toggle">
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label={t('audioSeek')}
          aria-valuetext={`${fmt(current)} / ${fmt(duration)}`}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]"
          data-testid="player-seek"
        />
        <span className="tabular shrink-0 text-right text-xs text-muted-foreground" aria-hidden>
          {fmt(current)} / {fmt(duration)}
        </span>
      </div>
      {!compact ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:pl-11">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => seekTo(current - SEEK_STEP_SEC)} aria-label={t('audioBack5')} title={t('audioBack5')} data-testid="player-back">
            <RotateCcw aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="mr-1" onClick={() => seekTo(current + SEEK_STEP_SEC)} aria-label={t('audioForward5')} title={t('audioForward5')} data-testid="player-forward">
            <RotateCw aria-hidden />
          </Button>
          <span className="text-xs text-muted-foreground">{t('audioSpeed')}</span>
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rate === r}
              onClick={() => {
                setRate(r);
                if (ref.current) ref.current.playbackRate = r;
              }}
              className={cn(
                'tabular rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                rate === r ? 'border-navy bg-navy text-navy-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground' : 'border-border hover:bg-muted',
              )}
              data-testid={`player-rate-${r}`}
            >
              {t('audioRate', { rate: r })}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={loop}
            onClick={() => setLoop((l) => !l)}
            className={cn(
              'ml-1 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              loop ? 'border-accent bg-accent/15 text-foreground' : 'border-border hover:bg-muted',
            )}
            data-testid="player-loop"
          >
            <Repeat className="size-3.5" aria-hidden />
            {t('audioLoop')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
