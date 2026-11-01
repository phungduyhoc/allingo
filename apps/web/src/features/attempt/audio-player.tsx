'use client';

import * as React from 'react';
import { Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@allingo/ui';

export interface AudioPlayerProps {
  src: string;
  /** once: Exam Mode phát một lần, không tua, không nghe lại; free: tua tự do */
  policy: 'once' | 'free';
  /** Đã phát (khôi phục sau khi tải lại trang) */
  played?: boolean;
  onPlayed?: () => void;
  onStarted?: () => void;
  autoPlay?: boolean;
  className?: string;
}

/**
 * Trình phát audio cho Listening. Với policy 'once' không dùng <audio controls> (cho phép tua),
 * mà tự vẽ nút phát; sau khi kết thúc khoá nút và báo `onPlayed` để lưu sự kiện audio_played.
 */
export function AudioPlayer({ src, policy, played = false, onPlayed, onStarted, autoPlay = false, className }: AudioPlayerProps) {
  const t = useTranslations('attempt');
  const ref = React.useRef<HTMLAudioElement>(null);
  const [state, setState] = React.useState<'idle' | 'playing' | 'paused' | 'ended'>(played && policy === 'once' ? 'ended' : 'idle');
  const [progress, setProgress] = React.useState(0);
  const startedRef = React.useRef(false);

  // Đổi câu → cha truyền `key` mới để remount (trạng thái phát không mang sang câu khác)
  const locked = policy === 'once' && state === 'ended';

  React.useEffect(() => {
    // Tự phát khi vào câu Listening ở Exam Mode (nếu chưa phát); chỉ chạy khi đổi src
    if (autoPlay && policy === 'once' && !played && ref.current) {
      ref.current.play().catch(() => undefined);
    }
  }, [src, autoPlay, policy, played]);

  const toggle = () => {
    const el = ref.current;
    if (!el || locked) return;
    if (state === 'playing') {
      // Exam Mode: không cho tạm dừng để tránh "tua" bằng cách dừng rồi nghe lại
      if (policy === 'once') return;
      el.pause();
      return;
    }
    el.play().catch(() => undefined);
  };

  const replay = () => {
    const el = ref.current;
    if (!el || policy === 'once') return;
    el.currentTime = 0;
    el.play().catch(() => undefined);
  };

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-border bg-card p-3', className)} data-testid="audio-player" data-policy={policy}>
      <audio
        ref={ref}
        src={src}
        preload="auto"
        controls={policy === 'free'}
        className={policy === 'free' ? 'h-10 w-full' : 'hidden'}
        aria-label={t('audioLabel')}
        onPlay={() => {
          setState('playing');
          if (!startedRef.current) {
            startedRef.current = true;
            onStarted?.();
          }
        }}
        onPause={() => setState((s) => (s === 'ended' ? s : 'paused'))}
        onEnded={() => {
          setState('ended');
          setProgress(100);
          onPlayed?.();
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) setProgress((el.currentTime / el.duration) * 100);
        }}
      />
      {policy === 'once' ? (
        <>
          <Button variant={locked ? 'outline' : 'navy'} size="icon" aria-label={state === 'playing' ? t('audioPause') : t('audioPlay')} disabled={locked || state === 'playing'} onClick={toggle} data-testid="audio-play">
            {state === 'playing' ? <Volume2 className="animate-pulse" aria-hidden /> : <Play aria-hidden />}
          </Button>
          <div className="min-w-0 flex-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{t('audioOnceHint')}</p>
          </div>
          {locked ? <Badge variant="muted">{t('audioPlayed')}</Badge> : <Badge variant="gold">{t('listenPolicyExam')}</Badge>}
        </>
      ) : (
        <Button variant="ghost" size="icon" aria-label={t('audioReplay')} onClick={replay}>
          {state === 'playing' ? <Pause aria-hidden /> : <RotateCcw aria-hidden />}
        </Button>
      )}
    </div>
  );
}
