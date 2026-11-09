'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';
import type { TranscriptHighlight } from '@/lib/types';
import { activeLineIndex, hasTimings, markEvidence, speakerTone, transcriptLines } from './transcript-format';

/** m:ss của mốc transcript */
const formatMs = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const TONE_CLASS = {
  man: 'bg-navy text-navy-foreground dark:bg-primary dark:text-primary-foreground',
  woman: 'bg-accent text-accent-foreground',
  narrator: 'bg-muted text-muted-foreground',
  other: 'bg-secondary text-secondary-foreground',
} as const;

/**
 * Transcript Listening – chỉ hiển thị SAU khi nộp (Review) hoặc sau khi trả lời ở Practice (API mới trả). Người nói M/W/N
 * thành nhãn màu; `activeMs` (vị trí trình phát) tô dòng đang phát theo `segments`; `evidence` được tô vàng.
 */
export function Transcript({
  transcript,
  evidence,
  activeMs = null,
  className,
  evidenceLines,
  onSeek,
}: {
  transcript: TranscriptHighlight;
  evidence?: readonly (string | null | undefined)[];
  activeMs?: number | null;
  className?: string;
  /** C3: chỉ số dòng (segments) chứa đáp án – server so khớp `evidence_segments`; gộp thêm từ các câu cùng nhóm */
  evidenceLines?: readonly number[];
  /** C3: bấm dòng có mốc thời gian → tua trình phát tới đó */
  onSeek?: (ms: number) => void;
}) {
  const t = useTranslations('review');
  const lines = React.useMemo(() => transcriptLines(transcript), [transcript]);
  const timed = hasTimings(lines);
  const active = timed ? activeLineIndex(lines, activeMs) : -1;
  // C3: evidence của câu nhiều mục là nhiều dòng (nối bằng xuống dòng) → tô từng dòng
  const marks = React.useMemo(() => [transcript.evidence, ...(evidence ?? [])].flatMap((e) => (e ? e.split('\n') : [])), [evidence, transcript.evidence]);
  const evidenceSet = React.useMemo(() => new Set([...(transcript.evidence_segments ?? []), ...(evidenceLines ?? [])]), [evidenceLines, transcript.evidence_segments]);
  const activeRef = React.useRef<HTMLLIElement | null>(null);

  React.useEffect(() => {
    // Dòng đang phát ra khỏi khung cuộn → cuộn riêng khung transcript (không kéo cả trang)
    const li = activeRef.current;
    const box = li?.parentElement;
    if (!li || !box) return;
    if (li.offsetTop < box.scrollTop) box.scrollTop = li.offsetTop - 8;
    else if (li.offsetTop + li.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = li.offsetTop + li.offsetHeight - box.clientHeight + 8;
  }, [active]);

  return (
    <section
      className={cn('rounded-lg border border-border bg-background', className)}
      aria-label={t('transcriptTitle')}
      data-testid="transcript"
      data-timed={timed}
    >
      <h4 className="border-b border-border px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('transcriptTitle')}
      </h4>
      {/* Khung cuộn riêng nhận focus bàn phím (transcript dài – IELTS Listening; axe scrollable-region-focusable) */}
      <ol className="relative max-h-72 space-y-1 overflow-y-auto p-2 text-sm leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" data-lookup="" tabIndex={0} aria-label={t('transcriptTitle')}>
        {lines.map((l, i) => (
          <li
            key={i}
            ref={i === active ? activeRef : undefined}
            className={cn(
              'flex gap-2 rounded-md px-2 py-1 transition-colors',
              evidenceSet.has(i) && 'border-l-4 border-accent bg-accent/10',
              i === active && 'bg-primary/10 ring-1 ring-primary/30',
            )}
            data-testid="transcript-line"
            data-active={i === active}
            data-evidence={evidenceSet.has(i) || undefined}
            aria-current={i === active ? 'true' : undefined}
          >
            {l.speaker ? (
              <span
                className={cn(
                  'tabular mt-0.5 inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded px-1 text-[11px] font-bold',
                  TONE_CLASS[speakerTone(l.speaker)],
                )}
                title={t(`speaker.${speakerTone(l.speaker)}`)}
                data-testid="transcript-speaker"
              >
                {l.speaker}
              </span>
            ) : null}
            {onSeek && l.startMs !== null ? (
              <button
                type="button"
                className="tabular shrink-0 rounded px-1 text-[11px] font-semibold text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
                onClick={() => onSeek(l.startMs!)}
                aria-label={t('seekTo', { time: formatMs(l.startMs) })}
                data-testid="transcript-seek"
              >
                {formatMs(l.startMs)}
              </button>
            ) : null}
            <span className="min-w-0">
              {markEvidence(l.text, marks).map((p, j) =>
                p.mark ? (
                  <mark
                    key={j}
                    className="rounded bg-accent/40 px-0.5 text-foreground"
                    data-testid="transcript-evidence"
                  >
                    {p.text}
                  </mark>
                ) : (
                  <React.Fragment key={j}>{p.text}</React.Fragment>
                ),
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
