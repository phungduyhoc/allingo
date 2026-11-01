'use client';

import { Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';

export interface GridItem {
  questionId: string;
  number: number;
  answered: boolean;
  flagged: boolean;
}

export function QuestionGrid({ items, currentIndex, onSelect, className }: { items: GridItem[]; currentIndex: number; onSelect: (index: number) => void; className?: string }) {
  const t = useTranslations('attempt');
  const answered = items.filter((i) => i.answered).length;
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{t('gridTitle')}</span>
        <span className="tabular text-muted-foreground" data-testid="grid-progress">
          {t('progress', { answered, total: items.length })}
        </span>
      </div>
      <ol className="grid grid-cols-5 gap-2 sm:grid-cols-6 lg:grid-cols-5" aria-label={t('gridTitle')}>
        {items.map((it, idx) => {
          const current = idx === currentIndex;
          return (
            <li key={it.questionId}>
              <button
                type="button"
                onClick={() => onSelect(idx)}
                aria-current={current ? 'true' : undefined}
                aria-label={`${t('questionNumber', { number: it.number })}: ${it.answered ? t('answered') : t('unanswered')}${it.flagged ? `, ${t('flagged')}` : ''}`}
                data-testid={`grid-${it.number}`}
                data-answered={it.answered}
                className={cn(
                  'relative flex h-10 w-full items-center justify-center rounded-md border text-sm font-semibold tabular transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                  it.answered ? 'border-navy bg-navy text-navy-foreground dark:border-primary dark:bg-primary dark:text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-muted',
                  current && 'ring-2 ring-accent ring-offset-2 ring-offset-background',
                )}
              >
                {it.number}
                {it.flagged ? <Flag className="absolute -top-1.5 -right-1.5 size-3.5 fill-accent text-accent" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ol>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-navy dark:bg-primary" /> {t('answered')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-border bg-card" /> {t('unanswered')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Flag className="size-3 fill-accent text-accent" /> {t('flagged')}
        </li>
      </ul>
    </div>
  );
}
