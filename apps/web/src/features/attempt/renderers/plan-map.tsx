'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn, NativeSelect } from '@allingo/ui';
import type { PublicQuestionContent } from '@/lib/types';
import { DiagramFigure } from './figure';
import type { RendererProps } from './types';
import { useNumberBase } from './number-base';

/**
 * C2 – gán nhãn bản đồ/mặt bằng bằng chữ cái (IELTS Listening "Label the map. Choose the correct letter A–F"): mỗi địa điểm một
 * `<select>` chữ cái (thao tác chính – bàn phím/mobile/trình đọc màn hình); chuột có thể chọn địa điểm rồi bấm ghim trên ảnh.
 * Không cần nhìn: alt + khối "Mô tả bằng chữ" (image_alt + mô tả từng vị trí).
 */

type Content = Extract<PublicQuestionContent, { type: 'plan_map_labelling' }>;
type Answer = { type: 'plan_map_labelling'; values: Record<string, string> };

export function PlanMap({ content, answer, onChange, disabled, review, questionId, resolveImage }: RendererProps<Content, Answer> & { resolveImage?: (assetId: string) => string | null }) {
  const t = useTranslations('attempt.rl');
  const values = answer?.values ?? {};
  const base = useNumberBase();
  const correct = (review?.correctAnswer ?? null) as Record<string, string> | null;
  const locked = disabled || !!review;
  const firstOpen = content.items.find((i) => !values[i.key])?.key ?? content.items[0]?.key ?? null;
  const [active, setActive] = React.useState<string | null>(firstOpen);
  const set = (item: string, key: string) => {
    const next = { ...values };
    if (key) next[item] = key;
    else delete next[item];
    onChange({ type: 'plan_map_labelling', values: next });
  };

  return (
    <div className="space-y-4" data-testid="renderer-plan_map_labelling">
      {content.title ? <h3 className="text-base font-bold">{content.title}</h3> : null}
      <DiagramFigure
        src={resolveImage?.(content.image_asset_id) ?? null}
        alt={content.image_alt}
        pins={content.markers.map((m) => ({ key: m.key, x: m.x, y: m.y, label: m.key, description: m.description }))}
        questionId={questionId}
        disabled={locked}
        onPinClick={locked || !active ? undefined : (key) => {
          set(active, key);
          // Chuyển sang địa điểm kế tiếp chưa gán
          const next = content.items.find((i) => i.key !== active && !values[i.key])?.key;
          if (next) setActive(next);
        }}
        activePin={active ? (values[active] ?? null) : null}
      />
      {!locked ? <p className="text-xs text-muted-foreground">{t('mapHint')}</p> : null}
      <ol className="space-y-2" aria-label={t('itemsLabel')}>
        {content.items.map((it, k) => {
          const ok = review?.details?.[it.key];
          const selectId = `q-${questionId}-place-${it.key}`;
          return (
            <li
              key={it.key}
              className={cn('flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3', active === it.key && !locked ? 'border-accent ring-2 ring-accent/30' : 'border-border', review && ok === true && 'border-success', review && ok === false && 'border-destructive')}
              data-testid={`place-row-${it.key}`}
              data-sub={it.key}
              data-state={review ? (ok ? 'correct' : 'wrong') : undefined}
            >
              <label htmlFor={selectId} className="text-base">
                <span className="tabular mr-2 rounded bg-muted px-1.5 text-xs font-bold text-muted-foreground">{base + k}</span>
                {/^\d+$/.test(it.key) ? null : <span className="mr-2 font-semibold tabular">{it.key}.</span>}
                {it.text}
              </label>
              <div className="flex flex-col items-end gap-1">
                <NativeSelect id={selectId} value={values[it.key] ?? ''} disabled={locked} onFocus={() => setActive(it.key)} onChange={(e) => set(it.key, e.target.value)} aria-invalid={review && ok === false ? true : undefined} className="w-28" data-testid={`place-select-${it.key}`}>
                  <option value="">{t('choose')}</option>
                  {content.markers.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.key}
                    </option>
                  ))}
                </NativeSelect>
                {review && ok === false && correct?.[it.key] ? (
                  <span className="text-xs font-medium text-success" data-testid={`place-correct-${it.key}`}>
                    {t('correctIs', { answer: correct[it.key]! })}
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
