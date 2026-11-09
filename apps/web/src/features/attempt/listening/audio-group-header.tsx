'use client';

import { Headphones, Lock, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, cn } from '@allingo/ui';
import type { QuestionPublic, TranscriptHighlight } from '@/lib/types';
import { Transcript } from '@/features/review/transcript';
import { AudioPlayer } from '../audio-player';
import type { ListenStatus } from '../question-block';

type Passage = NonNullable<QuestionPublic['passage']>;

/**
 * Đầu nhóm Part 3/4 (passage `audio_script` – transcript không trả khi đang làm bài):
 * - Exam Mode: tiêu đề hội thoại + trạng thái nghe (sắp phát / đang phát / đã phát), không có nút phát.
 * - Practice/drill: trình phát tự do audio cả nhóm (tua, tốc độ, lặp) + transcript khi cả nhóm đã trả lời.
 */
export function AudioGroupHeader({
  passage,
  rangeLabel,
  exam,
  player,
  transcript,
}: {
  passage: Passage;
  rangeLabel?: string;
  exam?: { status: ListenStatus } | null;
  player?: { src: string; onError: () => void; onStarted?: () => void } | null;
  transcript?: TranscriptHighlight | null;
}) {
  const t = useTranslations('attempt');
  const title = passage.title ?? t('audioGroupTitle');
  return (
    <section className={cn('rounded-xl border bg-card p-4', exam?.status === 'playing' ? 'border-accent ring-2 ring-accent/30' : 'border-border')} aria-label={title} data-testid="audio-group" data-status={exam?.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Headphones className="size-5 text-navy dark:text-accent" aria-hidden />
        <h2 className="text-base font-semibold">{title}</h2>
        {rangeLabel ? <span className="text-xs text-muted-foreground">· {rangeLabel}</span> : null}
        {exam ? (
          <span className="ml-auto">
            {exam.status === 'playing' ? (
              <Badge variant="gold">
                <Volume2 className="animate-pulse" aria-hidden />
                {t('listenNow')}
              </Badge>
            ) : exam.status === 'preread' ? (
              <Badge variant="secondary" data-testid="preread-badge">
                {t('ieltsPrereadBadge')}
              </Badge>
            ) : exam.status === 'played' ? (
              <Badge variant="muted">{t('audioPlayed')}</Badge>
            ) : (
              <Badge variant="muted">
                <Lock aria-hidden />
                {t('listenUpcoming')}
              </Badge>
            )}
          </span>
        ) : null}
      </div>
      {exam ? <p className="mt-2 text-sm text-muted-foreground">{t('audioGroupExamHint')}</p> : null}
      {player ? <AudioPlayer src={player.src} onError={player.onError} onStarted={player.onStarted} label={title} className="mt-3" data-testid="group-audio-player" /> : null}
      {transcript ? <Transcript transcript={transcript} className="mt-3" /> : null}
    </section>
  );
}
