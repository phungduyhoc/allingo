'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';
import type { AnswerInputOf, PublicQuestionContent } from '@/lib/types';
import type { RendererProps } from './types';

type Content = Extract<PublicQuestionContent, { type: 'mcq_multi' }>;
type Answer = AnswerInputOf<'mcq_multi'>;

export function McqMulti({ content, answer, onChange, disabled, review, questionId }: RendererProps<Content, Answer>) {
  const t = useTranslations('attempt');
  const selected = new Set(answer?.selected ?? []);
  const correct = new Set(Array.isArray(review?.correctAnswer) ? (review.correctAnswer as string[]) : []);

  // C2 – "Choose TWO letters": đủ số lựa chọn → khoá các lựa chọn còn lại (bỏ chọn một lựa chọn để đổi)
  const limit = content.select_count ?? null;
  const full = limit !== null && selected.size >= limit;
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else if (full) return;
    else next.add(key);
    onChange({ type: 'mcq_multi', selected: content.options.filter((o) => next.has(o.key)).map((o) => o.key) });
  };

  return (
    <div role="group" aria-labelledby={`q-${questionId}-stem`} className="space-y-2">
      <p className="text-xs text-muted-foreground" data-testid="mcq-multi-hint">
        {limit !== null ? t('mcqSelectCount', { count: limit, selected: selected.size }) : t('mcqMultiHint')}
      </p>
      {content.options.map((o) => {
        const isSelected = selected.has(o.key);
        const state = review ? (correct.has(o.key) ? 'correct' : isSelected ? 'wrong' : undefined) : undefined;
        return (
          <button
            key={o.key}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            disabled={disabled || !!review || (full && !isSelected)}
            data-selected={isSelected}
            data-state={state}
            data-testid={`option-${o.key}`}
            onClick={() => toggle(o.key)}
            className={cn(
              'omr-option flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-base transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              'border-border bg-card hover:bg-muted disabled:cursor-default',
              isSelected && !review && 'border-navy bg-navy/5 dark:border-accent dark:bg-accent/10',
              state === 'correct' && 'border-success bg-success/10',
              state === 'wrong' && 'border-destructive bg-destructive/10',
            )}
          >
            <span className="omr-bubble rounded-md" aria-hidden>
              {isSelected ? <Check className="size-4" /> : o.key}
            </span>
            <span className="leading-snug">{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}
