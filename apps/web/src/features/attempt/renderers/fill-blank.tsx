'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn, Input } from '@allingo/ui';
import type { AnswerInputOf, PublicQuestionContent } from '@/lib/types';
import type { RendererProps } from './types';

type Content = Extract<PublicQuestionContent, { type: 'fill_blank' }>;
type Answer = AnswerInputOf<'fill_blank'>;

/** Đề bài dùng {{b1}}, {{b2}} đánh dấu chỗ trống → render ô nhập inline */
export function FillBlank({ content, answer, onChange, disabled, review, questionId }: RendererProps<Content, Answer>) {
  const t = useTranslations('attempt');
  const values = answer?.blanks ?? {};
  const parts = React.useMemo(() => content.stem.split(/(\{\{\w+\}\})/g), [content.stem]);
  const correct = (review?.correctAnswer ?? null) as Record<string, string[]> | null;

  const set = (id: string, v: string) => onChange({ type: 'fill_blank', blanks: { ...values, [id]: v } });

  return (
    <div className="space-y-4">
      <p className="text-base leading-9" id={`q-${questionId}-stem-inline`}>
        {parts.map((p, i) => {
          const m = /^\{\{(\w+)\}\}$/.exec(p);
          if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
          const id = m[1]!;
          const ok = review?.details?.[id];
          return (
            <span key={i} className="mx-1 inline-flex flex-col align-baseline">
              <Input
                aria-label={t('fillBlankPlaceholder', { id })}
                value={values[id] ?? ''}
                disabled={disabled || !!review}
                aria-invalid={review && ok === false ? true : undefined}
                onChange={(e) => set(id, e.target.value)}
                className={cn('inline-block h-9 w-36 border-b-2 border-x-0 border-t-0 rounded-none bg-transparent px-1 text-center shadow-none focus-visible:ring-0', review && ok === true && 'border-success text-success', review && ok === false && 'border-destructive text-destructive')}
                autoComplete="off"
                spellCheck={false}
              />
            </span>
          );
        })}
      </p>
      {review && correct ? (
        <ul className="space-y-1 text-sm">
          {content.blanks.map((b) => (
            <li key={b.id} className="flex gap-2">
              <span className="font-semibold">{b.id}:</span>
              <span className="text-success">{(correct[b.id] ?? []).join(' / ')}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
