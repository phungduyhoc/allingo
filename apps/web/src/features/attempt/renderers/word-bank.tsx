'use client';

import * as React from 'react';
import { Check, GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { gapTokens } from '@allingo/schemas/question/rl-types';
import { cn, NativeSelect } from '@allingo/ui';
import type { PublicQuestionContent } from '@/lib/types';
import { gapNumbers, GapText } from './gaps';
import type { RendererProps } from './types';

/**
 * C2 – hoàn thành tóm tắt bằng ngân hàng từ (A–L): mỗi chỗ trống một `<select>` gốc trong đoạn văn; kéo thẻ từ vào chỗ trống là
 * phương án thêm cho chuột. Không cho dùng lại từ (mặc định) → chọn từ đã dùng sẽ gỡ khỏi chỗ trống cũ.
 */

type Content = Extract<PublicQuestionContent, { type: 'summary_word_bank' }>;
type Answer = { type: 'summary_word_bank'; gaps: Record<string, string> };

const DRAG_MIME = 'application/x-allingo-word';

export function WordBank({ content, answer, onChange, disabled, review, questionId }: RendererProps<Content, Answer>) {
  const t = useTranslations('attempt.rl');
  const ids = gapTokens(content.text);
  const numbers = gapNumbers(ids);
  const values = answer?.gaps ?? {};
  const correct = (review?.correctAnswer ?? null) as Record<string, string> | null;
  const locked = disabled || !!review;
  const bank = React.useMemo(() => new Map(content.bank.map((b) => [b.key, b.text])), [content.bank]);
  const used = new Set(Object.values(values).filter(Boolean));
  const [over, setOver] = React.useState<string | null>(null);

  const set = (id: string, key: string) => {
    const next: Record<string, string> = { ...values };
    if (!key) delete next[id];
    else {
      if (!content.allow_reuse) for (const [k, v] of Object.entries(next)) if (v === key && k !== id) delete next[k];
      next[id] = key;
    }
    onChange({ type: 'summary_word_bank', gaps: next });
  };

  const gap = (id: string) => {
    const ok = review?.details?.[id];
    const n = numbers.get(id) ?? 0;
    return (
      <span
        className={cn('mx-1 inline-flex max-w-full flex-col align-baseline', over === id && 'rounded ring-2 ring-accent/50')}
        onDragOver={(e) => {
          if (locked) return;
          e.preventDefault();
          setOver(id);
        }}
        onDragLeave={() => setOver((x) => (x === id ? null : x))}
        onDrop={(e) => {
          if (locked) return;
          e.preventDefault();
          setOver(null);
          const key = e.dataTransfer.getData(DRAG_MIME);
          if (key && bank.has(key)) set(id, key);
        }}
        data-gap={id}
        data-state={review ? (ok ? 'correct' : 'wrong') : undefined}
      >
        <span className="inline-flex items-center gap-1">
          <span className="tabular rounded bg-muted px-1.5 text-xs font-bold text-muted-foreground" aria-hidden>
            {n}
          </span>
          <NativeSelect
            aria-label={t('gapLabel', { number: n })}
            value={values[id] ?? ''}
            disabled={locked}
            aria-invalid={review && ok === false ? true : undefined}
            onChange={(e) => set(id, e.target.value)}
            className={cn('h-9 w-auto max-w-[60vw] py-0', review && ok === true && 'border-success text-success', review && ok === false && 'border-destructive text-destructive')}
            data-testid={`bank-select-${id}`}
          >
            <option value="">{t('choose')}</option>
            {content.bank.map((b) => (
              <option key={b.key} value={b.key}>
                {`${b.key} – ${b.text}${!content.allow_reuse && used.has(b.key) && values[id] !== b.key ? ` ${t('usedSuffix')}` : ''}`}
              </option>
            ))}
          </NativeSelect>
        </span>
        {review && ok === false && correct?.[id] ? (
          <span className="mt-0.5 text-xs font-medium text-success" data-testid={`bank-correct-${id}`}>
            {`${correct[id]} – ${bank.get(correct[id]) ?? ''}`}
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <div className="space-y-4" data-testid="renderer-summary_word_bank">
      <section className="rounded-lg border border-border bg-background p-3" aria-labelledby={`q-${questionId}-bank`}>
        <h3 id={`q-${questionId}-bank`} className="mb-2 text-sm font-semibold">
          {t('wordBank')}
        </h3>
        <ul className="flex flex-wrap gap-1.5">
          {content.bank.map((b) => (
            <li
              key={b.key}
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, b.key);
                e.dataTransfer.effectAllowed = 'move';
              }}
              // Đã dùng: nền muted + dấu ✓ (không giảm opacity – giữ tương phản chữ AA)
              className={cn('inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-sm', !locked && 'cursor-grab', !content.allow_reuse && used.has(b.key) && 'border-dashed bg-muted')}
              data-testid={`bank-chip-${b.key}`}
              data-used={(!content.allow_reuse && used.has(b.key)) || undefined}
            >
              {!locked ? <GripVertical className="size-3.5 text-muted-foreground" aria-hidden /> : null}
              <span className="font-bold">{b.key}</span>
              <span>{b.text}</span>
              {!content.allow_reuse && used.has(b.key) ? (
                <>
                  <Check className="size-3.5 text-foreground" aria-hidden />
                  <span className="sr-only">{t('usedSuffix')}</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <div className="rounded-lg border border-border bg-background p-4">
        {content.title ? <h3 className="mb-2 text-base font-bold">{content.title}</h3> : null}
        {content.text.split(/\n{2,}/).map((para, i) => (
          <p key={i} className="text-base leading-10">
            <GapText text={para} renderGap={gap} />
          </p>
        ))}
      </div>
    </div>
  );
}
