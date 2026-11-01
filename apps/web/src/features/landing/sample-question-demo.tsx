'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, cn } from '@allingo/ui';

const KEYS = ['A', 'B', 'C', 'D'] as const;
const CORRECT = 'B';

/** Câu mẫu Part 5 tương tác trên landing: bấm đáp án → thấy ngay cách AI giải thích */
export function SampleQuestionDemo() {
  const t = useTranslations('landing');
  const ta = useTranslations('attempt');
  const [selected, setSelected] = React.useState<string | null>(null);
  const revealed = selected !== null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_20px_60px_-30px_rgba(11,31,75,0.45)] sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground">{t('sampleTitle')}</span>
        <span className="tabular text-xs font-medium text-muted-foreground" aria-hidden>
          00:42
        </span>
      </div>
      <p className="text-base leading-relaxed font-medium sm:text-lg">{t('sampleStem')}</p>
      <ul className="mt-4 space-y-2" aria-label={t('sampleTitle')}>
        {KEYS.map((k) => {
          const state = !revealed ? undefined : k === CORRECT ? 'correct' : k === selected ? 'wrong' : undefined;
          return (
            <li key={k}>
              <button
                type="button"
                className={cn(
                  'omr-option flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-muted',
                  state === 'correct' && 'bg-success/10',
                  state === 'wrong' && 'bg-destructive/10',
                )}
                data-selected={selected === k}
                data-state={state}
                aria-pressed={selected === k}
                aria-label={ta('optionLabel', { key: k })}
                onClick={() => setSelected(k)}
              >
                <span className="omr-bubble" aria-hidden>
                  {k}
                </span>
                <span className="text-sm sm:text-base">{t(`sampleOptions.${k}`)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div
        className={cn('mt-4 overflow-hidden rounded-xl border border-accent/70 bg-accent/10 transition-[max-height,opacity] duration-300', revealed ? 'max-h-40 opacity-100' : 'max-h-0 border-transparent opacity-0')}
        aria-live="polite"
      >
        <div className="flex items-start gap-3 p-4">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-foreground dark:text-accent" aria-hidden />
          <div className="space-y-1">
            <Badge variant="gold">{t('sampleBadge')}</Badge>
            <p className="text-sm leading-relaxed">{t('sampleExplain')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
