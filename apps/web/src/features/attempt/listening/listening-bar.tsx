'use client';

import * as React from 'react';
import { Crosshair, Headphones, Hourglass, Loader2, Lock, Volume2, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@allingo/ui';
import type { ExamListening } from './use-exam-listening';
import { formatClock } from '../clock';

/**
 * Màn "Bắt đầu nghe" (bắt buộc bấm: trình duyệt chặn tự phát âm thanh khi chưa có cử chỉ người dùng – kể cả sau khi tải lại).
 * Nút gọi `listening.start()` ngay trong trình xử lý click.
 */
export function ListeningGate({ listening, partLabel }: { listening: ExamListening; partLabel: string }) {
  const t = useTranslations('attempt');
  const titleId = React.useId();
  const descId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    buttonRef.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} data-testid="listening-gate" data-resumed={listening.resumed}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-accent/20 text-accent-foreground dark:text-accent">
            <Headphones className="size-6" aria-hidden />
          </span>
          <div>
            <h2 id={titleId} className="text-lg font-bold">
              {listening.resumed ? t('listeningResumeTitle') : t('listeningStartTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{partLabel}</p>
          </div>
        </div>
        <ul id={descId} className="mb-5 space-y-2 text-sm leading-relaxed">
          <li className="flex gap-2">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t('listeningRuleOnce')}
          </li>
          <li className="flex gap-2">
            <Crosshair className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t('listeningRuleAnswer')}
          </li>
          <li className="flex gap-2">
            <Volume2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {listening.resumed ? t('listeningRuleResume') : t('listeningRuleCheck')}
          </li>
        </ul>
        <Button ref={buttonRef} variant="gold" size="lg" className="w-full" onClick={() => listening.start()} data-testid="start-listening">
          <Headphones aria-hidden />
          {listening.resumed ? t('listeningResume') : t('listeningStart')}
        </Button>
      </div>
    </div>
  );
}

/** Thanh trạng thái Listening (không có nút tạm dừng/tua): đang phát câu nào, thời gian trả lời còn lại, mất mạng */
export function ListeningBar({ listening, nowLabel, following, onJump, online, className }: { listening: ExamListening; nowLabel: string; following: boolean; onJump: () => void; online: boolean; className?: string }) {
  const t = useTranslations('attempt');
  const [progress, setProgress] = React.useState({ elapsedMs: 0, totalMs: null as number | null });
  const { readProgress, phase } = listening;
  React.useEffect(() => {
    if (phase === 'gate' || phase === 'done') return;
    const id = window.setInterval(() => setProgress(readProgress()), 250);
    return () => window.clearInterval(id);
  }, [phase, readProgress]);

  if (phase === 'done') return null;
  const pct = progress.totalMs ? Math.min(100, (progress.elapsedMs / progress.totalMs) * 100) : 0;
  const pauseLeft = phase === 'pause' && progress.totalMs ? Math.max(0, Math.ceil((progress.totalMs - progress.elapsedMs) / 1000)) : null;
  // C3 – IELTS: bước chờ là đọc trước part / xem lại cuối bài (không phải "thời gian trả lời" sau câu như TOEIC)
  const pausePhase = listening.current?.kind === 'pause' ? (listening.current.phase ?? 'answer') : 'answer';
  const status =
    phase === 'pause' && pausePhase === 'preread'
      ? t('ieltsPrereadTime', { seconds: pauseLeft ?? 0 })
      : phase === 'pause' && pausePhase === 'review'
        ? t('ieltsReviewTime', { time: formatClock((pauseLeft ?? 0) * 1000) })
        : phase === 'stalled'
      ? online
        ? t('listeningBuffering')
        : t('listeningOffline')
      : phase === 'loading'
        ? t('listeningLoading')
        : phase === 'pause'
          ? t('listeningAnswerTime', { seconds: pauseLeft ?? 0 })
          : phase === 'gate'
            ? t('listeningWaiting')
            : t('listeningPlaying');
  const Icon = phase === 'stalled' ? (online ? Loader2 : WifiOff) : phase === 'pause' ? Hourglass : phase === 'loading' ? Loader2 : Volume2;

  return (
    <div
      className={cn('sticky z-20 border-b backdrop-blur', phase === 'stalled' ? 'border-accent/50 bg-accent/20' : 'border-navy/20 bg-[color-mix(in_oklab,var(--background)_92%,var(--navy))]', className)}
      role="status"
      aria-live="polite"
      data-testid="listening-bar"
      data-phase={phase}
      data-step={listening.step}
      data-pause-phase={phase === 'pause' ? pausePhase : undefined}
      data-following={following}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2 sm:px-5">
        <Icon className={cn('size-5 shrink-0 text-navy dark:text-accent', phase === 'playing' && 'animate-pulse', (phase === 'loading' || (phase === 'stalled' && online)) && 'animate-spin')} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold" data-testid="listening-now">
              {nowLabel}
            </span>
            <span className="text-muted-foreground" data-testid="listening-status">
              {status}
            </span>
          </div>
          {/* Tiến trình chỉ để xem – không tương tác được (không tua) */}
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className={cn('h-full transition-[width] duration-200', phase === 'pause' ? 'bg-primary/50' : 'bg-accent')} style={{ width: `${pct}%` }} />
          </div>
        </div>
        {!following ? (
          <Button variant="outline" size="sm" onClick={onJump} data-testid="listening-jump">
            <Crosshair aria-hidden />
            <span className="hidden sm:inline">{t('listeningJump')}</span>
          </Button>
        ) : null}
        <Badge variant="gold" className="hidden shrink-0 sm:inline-flex">
          {t('listenPolicyExam')}
        </Badge>
      </div>
    </div>
  );
}
