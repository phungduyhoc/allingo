'use client';

import * as React from 'react';
import { Check, GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, cn, NativeSelect } from '@allingo/ui';
import type { PublicQuestionContent } from '@/lib/types';
import type { RendererProps } from './types';
import { useNumberBase } from './number-base';

/**
 * C2 – nối (matching headings / information / features / sentence endings + `matching` chung): mỗi mục một `<select>` gốc chọn
 * lựa chọn (bàn phím, trình đọc màn hình, mobile) – kéo thả thẻ lựa chọn vào mục là phương án thêm cho chuột (HTML5 DnD, không
 * thư viện). Không cho dùng lại lựa chọn → lựa chọn đã dùng ghi "(đã dùng)" và chọn lại sẽ chuyển khỏi mục cũ.
 */

type FamilyType = 'matching_headings' | 'matching_information' | 'matching_features' | 'matching_sentence_endings';
type Content = Extract<PublicQuestionContent, { type: FamilyType | 'matching' }>;
type Answer = { type: FamilyType | 'matching'; pairs: Record<string, string> };

export const MATCHING_TYPES: ReadonlySet<string> = new Set<string>(['matching', 'matching_headings', 'matching_information', 'matching_features', 'matching_sentence_endings']);

const DRAG_MIME = 'application/x-allingo-option';

export function Matching({ content, answer, onChange, disabled, review, questionId }: RendererProps<Content, Answer>) {
  const t = useTranslations('attempt.rl');
  const items = content.type === 'matching' ? content.left : content.items;
  const options = content.type === 'matching' ? content.right : content.options;
  const example = content.type === 'matching_headings' ? content.example : undefined;
  const pairs = answer?.pairs ?? {};
  const base = useNumberBase();
  // C3: số câu của từng mục (dòng ví dụ của matching headings không đánh số)
  const numberOf = new Map(items.filter((i) => i.key !== example?.item).map((i, k) => [i.key, base + k]));
  const correct = (review?.correctAnswer ?? null) as Record<string, string> | null;
  const locked = disabled || !!review;
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const optionText = React.useMemo(() => new Map(options.map((o) => [o.key, o.text])), [options]);
  const used = new Set(Object.values(pairs));
  if (example) used.add(example.option);

  const setPair = (item: string, option: string) => {
    const next: Record<string, string> = { ...pairs };
    if (!option) delete next[item];
    else {
      // Không dùng lại → gỡ lựa chọn khỏi mục khác trước khi gán
      if (!content.allow_reuse) for (const [k, v] of Object.entries(next)) if (v === option && k !== item) delete next[k];
      next[item] = option;
    }
    onChange({ type: content.type, pairs: next });
  };

  return (
    <div className="space-y-4" data-testid={`renderer-${content.type}`}>
      <section className="rounded-lg border border-border bg-background p-3" aria-labelledby={`q-${questionId}-options`}>
        <h3 id={`q-${questionId}-options`} className="mb-2 text-sm font-semibold">
          {('options_title' in content && content.options_title) || t('optionsTitle')}
        </h3>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {options.map((o) => {
            const isUsed = !content.allow_reuse && used.has(o.key);
            return (
              <li
                key={o.key}
                draggable={!locked}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, o.key);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                // Đã dùng: nền muted + dấu ✓ (không giảm opacity – giữ tương phản chữ AA)
                className={cn('flex items-start gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm', !locked && 'cursor-grab', isUsed && 'border-dashed bg-muted')}
                data-testid={`option-chip-${o.key}`}
                data-used={isUsed || undefined}
              >
                {!locked ? <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                <span className="font-bold">{o.key}</span>
                <span className="min-w-0 break-words">{o.text}</span>
                {isUsed ? (
                  <>
                    <Check className="mt-0.5 ml-auto size-3.5 shrink-0 text-foreground" aria-hidden />
                    <span className="sr-only">{t('usedSuffix')}</span>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!locked ? <p className="mt-2 text-xs text-muted-foreground">{content.allow_reuse ? t('reuseHint') : t('noReuseHint')}</p> : null}
      </section>

      <ol className="space-y-2" aria-label={t('itemsLabel')}>
        {items.map((it) => {
          const isExample = example?.item === it.key;
          const value = isExample ? example.option : (pairs[it.key] ?? '');
          const ok = review?.details?.[it.key];
          const selectId = `q-${questionId}-pair-${it.key}`;
          return (
            <li
              key={it.key}
              onDragOver={(e) => {
                if (locked || isExample) return;
                e.preventDefault();
                setDragOver(it.key);
              }}
              onDragLeave={() => setDragOver((k) => (k === it.key ? null : k))}
              onDrop={(e) => {
                if (locked || isExample) return;
                e.preventDefault();
                setDragOver(null);
                const key = e.dataTransfer.getData(DRAG_MIME);
                if (key && optionText.has(key)) setPair(it.key, key);
              }}
              className={cn(
                'flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between',
                dragOver === it.key ? 'border-accent ring-2 ring-accent/40' : 'border-border',
                review && !isExample && ok === true && 'border-success',
                review && !isExample && ok === false && 'border-destructive',
              )}
              data-testid={`pair-row-${it.key}`}
              data-sub={it.key}
              data-state={review && !isExample ? (ok ? 'correct' : 'wrong') : undefined}
            >
              <label htmlFor={selectId} className="min-w-0 text-base">
                {numberOf.has(it.key) ? <span className="tabular mr-2 rounded bg-muted px-1.5 text-xs font-bold text-muted-foreground" data-testid={`pair-number-${it.key}`}>{numberOf.get(it.key)}</span> : null}
                {/* Khoá dạng số (mục 1, 2, 3…) trùng nghĩa với số câu → chỉ hiện số câu */}
                {numberOf.has(it.key) && /^\d+$/.test(it.key) ? null : <span className="mr-2 font-semibold tabular">{it.key}.</span>}
                {it.text}
                {isExample ? (
                  <Badge variant="muted" className="ml-2">
                    {t('example')}
                  </Badge>
                ) : null}
              </label>
              <div className="flex shrink-0 flex-col gap-1 sm:items-end">
                <NativeSelect
                  id={selectId}
                  value={value}
                  disabled={locked || isExample}
                  aria-invalid={review && !isExample && ok === false ? true : undefined}
                  onChange={(e) => setPair(it.key, e.target.value)}
                  className="w-full max-w-full sm:w-56"
                  data-testid={`pair-select-${it.key}`}
                >
                  <option value="">{t('choose')}</option>
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {`${o.key} – ${o.text.length > 48 ? `${o.text.slice(0, 47)}…` : o.text}${!content.allow_reuse && used.has(o.key) && value !== o.key ? ` ${t('usedSuffix')}` : ''}`}
                    </option>
                  ))}
                </NativeSelect>
                {review && !isExample && ok === false && correct?.[it.key] ? (
                  <span className="text-xs font-medium text-success" data-testid={`pair-correct-${it.key}`}>
                    {t('correctIs', { answer: `${correct[it.key]} – ${optionText.get(correct[it.key]!) ?? ''}` })}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
