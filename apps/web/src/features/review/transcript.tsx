'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';
import type { TranscriptHighlight } from '@/lib/types';
import { activeLineIndex, hasTimings, markEvidence, speakerTone, transcriptLines } from './transcript-format';

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
}: {
  transcript: TranscriptHighlight;
  evidence?: readonly (string | null | undefined)[];
  activeMs?: number | null;
  className?: string;
}) {
  const t = useTranslations('review');
  const lines = React.useMemo(() => transcriptLines(transcript), [transcript]);
  const timed = hasTimings(lines);
  const active = timed ? activeLineIndex(lines, activeMs) : -1;
  const marks = React.useMemo(() => [transcript.evidence, ...(evidence ?? [])], [evidence, transcript.evidence]);
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
      <ol className="relative max-h-72 space-y-1 overflow-y-auto p-2 text-sm leading-relaxed" data-lookup="">
        {lines.map((l, i) => (
          <li
            key={i}
            ref={i === active ? activeRef : undefined}
            className={cn(
              'flex gap-2 rounded-md px-2 py-1 transition-colors',
              i === active && 'bg-primary/10 ring-1 ring-primary/30',
            )}
            data-testid="transcript-line"
            data-active={i === active}
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
