'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';
import type { AnswerInputOf, PublicQuestionContent } from '@/lib/types';
import type { RendererProps } from './types';
import { useNumberBase } from './number-base';

type Content = Extract<PublicQuestionContent, { type: 'tfng' }>;
type Answer = AnswerInputOf<'tfng'>;
type Value = 'true' | 'false' | 'not_given';

export function Tfng({ content, answer, onChange, disabled, review, questionId }: RendererProps<Content, Answer>) {
  const t = useTranslations('attempt.tfng');
  const base = useNumberBase();
  const values = answer?.values ?? {};
  const correct = (review?.correctAnswer ?? null) as Record<string, Value> | null;
  const labels: Record<Value, string> = content.variant === 'ynng' ? { true: t('yes'), false: t('no'), not_given: t('not_given') } : { true: t('true'), false: t('false'), not_given: t('not_given') };
  const choices: Value[] = ['true', 'false', 'not_given'];

  return (
    <ol className="space-y-3" aria-labelledby={`q-${questionId}-stem`}>
      {content.statements.map((s, idx) => {
        const chosen = values[s.key];
        const ok = review?.details?.[s.key];
        return (
          <li key={s.key} data-sub={s.key} className={cn('rounded-lg border border-border bg-card p-3', review && ok === true && 'border-success', review && ok === false && 'border-destructive')}>
            <p className="text-base">
              <span className="mr-2 font-semibold tabular">{base + idx}.</span>
              {s.text}
            </p>
            <div role="radiogroup" aria-label={s.text} className="mt-2 flex flex-wrap gap-2">
              {choices.map((v) => {
                const isSelected = chosen === v;
                const state = review ? (correct?.[s.key] === v ? 'correct' : isSelected ? 'wrong' : undefined) : undefined;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={disabled || !!review}
                    onClick={() => onChange({ type: 'tfng', values: { ...values, [s.key]: v } })}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default',
                      isSelected && !review ? 'border-navy bg-navy text-navy-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground' : 'border-border hover:bg-muted',
                      state === 'correct' && 'border-success bg-success text-success-foreground',
                      state === 'wrong' && 'border-destructive bg-destructive text-destructive-foreground',
                    )}
                  >
                    {labels[v]}
                  </button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
