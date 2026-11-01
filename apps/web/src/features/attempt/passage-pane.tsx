'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@allingo/ui';
import type { QuestionPublic } from '@/lib/types';
import { parsePassage } from './passage-format';

type Passage = NonNullable<QuestionPublic['passage']>;

/**
 * Đoạn văn Part 6–7. Desktop: khung trái cuộn riêng (giữ vị trí cuộn khi chuyển câu trong cùng nhóm).
 * Mobile: nằm trên câu hỏi, thu gọn được (aria-expanded) để dành chỗ cho câu hỏi.
 * `[Nhãn]` trên một dòng → tiêu đề phụ; `[131]`/`[1]` → nhãn mốc, tô sáng mốc mà câu đang xem hỏi tới.
 */
export function PassagePane({
  passage,
  zoom,
  highlight = [],
  collapsible = false,
  collapsed = false,
  onToggle,
  rangeLabel,
  className,
}: {
  passage: Passage;
  zoom: number;
  highlight?: string[];
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  rangeLabel?: string;
  className?: string;
}) {
  const t = useTranslations('attempt');
  const bodyId = `passage-${passage.id}`;
  const blocks = React.useMemo(() => parsePassage(passage.body), [passage.body]);
  const marks = new Set(highlight);
  return (
    <section aria-label={passage.title ?? t('passageTitle')} className={cn('scroll-mt-28 rounded-xl border border-border bg-card', className)} data-testid="passage" data-collapsed={collapsed}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{passage.title ?? t('passageTitle')}</h2>
          {rangeLabel ? <p className="text-xs text-muted-foreground">{rangeLabel}</p> : null}
        </div>
        {collapsible ? (
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={!collapsed} aria-controls={bodyId} data-testid="passage-toggle">
            {collapsed ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
            {collapsed ? t('passageExpand') : t('passageCollapse')}
          </Button>
        ) : null}
      </div>
      <div id={bodyId} className={cn('px-5 py-4', collapsed && 'max-h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_40%,transparent)]')} aria-hidden={collapsed || undefined}>
        <div className="space-y-3 text-[15px] leading-relaxed" style={zoom !== 1 ? { zoom } : undefined} data-testid="passage-body">
          {blocks.map((b, i) =>
            b.kind === 'heading' ? (
              <h3 key={i} className={cn('border-l-4 border-accent pl-2 text-sm font-bold tracking-wide text-navy uppercase dark:text-accent', i > 0 && 'pt-3')} data-testid="passage-heading">
                {b.text}
              </h3>
            ) : (
              <p key={i} className="whitespace-pre-wrap">
                {b.segments.map((s, j) =>
                  s.kind === 'text' ? (
                    <React.Fragment key={j}>{s.text}</React.Fragment>
                  ) : (
                    <span
                      key={j}
                      className={cn('tabular mx-0.5 inline-flex min-w-7 items-center justify-center rounded border px-1 text-xs font-bold align-[1px]', marks.has(s.id) ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-muted text-muted-foreground')}
                      data-testid={`passage-marker-${s.id}`}
                      data-active={marks.has(s.id)}
                    >
                      <span className="sr-only">[</span>
                      {s.id}
                      <span className="sr-only">]</span>
                    </span>
                  ),
                )}
              </p>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
