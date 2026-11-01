'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';
import type { AnswerInputOf, PublicQuestionContent } from '@/lib/types';
import type { RendererProps } from './types';

type Content = Extract<PublicQuestionContent, { type: 'mcq_single' }>;
type Answer = AnswerInputOf<'mcq_single'>;

export function McqSingle({ content, answer, onChange, disabled, review, questionId }: RendererProps<Content, Answer>) {
  const t = useTranslations('attempt');
  const selected = answer?.selected ?? null;
  const correct = review && typeof review.correctAnswer === 'string' ? review.correctAnswer : null;

  return (
    <div role="radiogroup" aria-labelledby={`q-${questionId}-stem`} className="space-y-2">
      {content.options.map((o) => {
        const isSelected = selected === o.key;
        const state = review ? (o.key === correct ? 'correct' : isSelected ? 'wrong' : undefined) : undefined;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={o.text ? undefined : t('optionLabel', { key: o.key })}
            disabled={disabled || !!review}
            data-selected={isSelected}
            data-state={state}
            data-testid={`option-${o.key}`}
            onClick={() => onChange({ type: 'mcq_single', selected: isSelected ? null : o.key })}
            className={cn(
              'omr-option flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-base transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              'border-border bg-card hover:bg-muted disabled:cursor-default',
              isSelected && !review && 'border-navy bg-navy/5 dark:border-accent dark:bg-accent/10',
              state === 'correct' && 'border-success bg-success/10',
              state === 'wrong' && 'border-destructive bg-destructive/10',
            )}
          >
            <span className="omr-bubble" aria-hidden>
              {o.key}
            </span>
            {o.text ? <span className="leading-snug">{o.text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
