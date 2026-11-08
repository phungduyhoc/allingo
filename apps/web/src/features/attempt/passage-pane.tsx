'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@allingo/ui';
import type { QuestionPublic } from '@/lib/types';
import { parsePassage, type PassageBlock } from './passage-format';

type Passage = NonNullable<QuestionPublic['passage']>;
export type PassagePart = NonNullable<Passage['parts']>[number];

/** B5/S24: passage nhiều văn bản (≥ 2 part) → tab từng văn bản; ít hơn → hiển thị `body` như trước (tương thích ngược) */
export function partsOf(passage: { parts?: PassagePart[] | null } | null | undefined): PassagePart[] {
  const parts = [...(passage?.parts ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return parts.length >= 2 ? parts : [];
}

/** Khối văn bản (tiêu đề phụ `[Nhãn]`, đoạn, mốc `[n]` tô sáng khi câu đang xem nhắc tới) */
export function PassageBlocks({ blocks, highlight, zoom = 1 }: { blocks: PassageBlock[]; highlight: Set<string>; zoom?: number }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed" style={zoom !== 1 ? { zoom } : undefined} data-testid="passage-body" data-lookup="">
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
                  className={cn(
                    'tabular mx-0.5 inline-flex min-w-7 items-center justify-center rounded border px-1 text-xs font-bold align-[1px]',
                    highlight.has(s.id) ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-muted text-muted-foreground',
                  )}
                  data-testid={`passage-marker-${s.id}`}
                  data-active={highlight.has(s.id)}
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
  );
}

/**
 * Tab từng văn bản của bộ đôi/bộ ba Part 7 – chuẩn WAI-ARIA tablist (kích hoạt tự động): ←/→ (vòng), Home/End chuyển tab và đưa
 * focus; chỉ tab đang chọn có tabIndex 0. Phím mũi tên trên tab KHÔNG chuyển câu (chặn lan tới phím tắt toàn trang của Exam Mode).
 * Đổi câu sang câu nhắc mốc `[n]` nằm ở văn bản khác → tự chọn văn bản đó. Nội dung tab là `role=tabpanel` có thể focus.
 */
export function PassageTabs({
  passageId,
  parts,
  highlight = [],
  zoom = 1,
  className,
  panelClassName,
  testId = 'passage-tabs',
  idPrefix,
}: {
  passageId: string;
  /** Tiền tố id phần tử (mặc định theo passage) – khi cùng passage hiển thị nhiều lần trên trang (Xem lại) */
  idPrefix?: string;
  parts: PassagePart[];
  highlight?: string[];
  zoom?: number;
  className?: string;
  panelClassName?: string;
  testId?: string;
}) {
  const t = useTranslations('attempt');
  const blocks = React.useMemo(() => parts.map((p) => parsePassage(p.body)), [parts]);
  const marks = React.useMemo(() => new Set(highlight), [highlight]);
  const [selected, setSelected] = React.useState(0);
  const tabsRef = React.useRef<Array<HTMLButtonElement | null>>([]);
  const markKey = highlight.join(',');

  // Passage khác → về văn bản đầu; mốc của câu đang xem nằm ở văn bản khác → chọn văn bản đó
  const [prev, setPrev] = React.useState({ passageId, markKey });
  if (prev.passageId !== passageId || prev.markKey !== markKey) {
    const withMark = markKey ? blocks.findIndex((bs) => bs.some((b) => b.kind === 'paragraph' && b.segments.some((s) => s.kind === 'marker' && marks.has(s.id)))) : -1;
    setPrev({ passageId, markKey });
    setSelected(withMark >= 0 ? withMark : prev.passageId !== passageId ? 0 : selected);
  }
  const current = Math.min(selected, parts.length - 1);
  const id = (k: string, i: number) => `${idPrefix ?? `passage-${passageId}`}-${k}-${i}`;
  const label = (p: PassagePart, i: number) => p.title?.trim() || t('passageTextN', { n: i + 1 });

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = parts.length - 1;
    const next = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(next);
    tabsRef.current[next]?.focus();
  };

  return (
    <div className={className} data-testid={testId} data-selected={current}>
      <div role="tablist" aria-label={t('passageTextsLabel', { count: parts.length })} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" data-testid="passage-tablist">
        {parts.map((p, i) => (
          <button
            key={p.id}
            ref={(el) => {
              tabsRef.current[i] = el;
            }}
            type="button"
            role="tab"
            id={id('tab', i)}
            aria-selected={i === current}
            aria-controls={id('panel', i)}
            tabIndex={i === current ? 0 : -1}
            onClick={() => setSelected(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              i === current ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted',
            )}
            data-testid={`passage-tab-${i + 1}`}
          >
            <FileText className="size-3.5" aria-hidden />
            <span className="tabular text-xs opacity-80">{i + 1}</span>
            <span className="max-w-48 truncate">{label(p, i)}</span>
          </button>
        ))}
      </div>
      {parts.map((p, i) => (
        <div
          key={p.id}
          role="tabpanel"
          id={id('panel', i)}
          aria-labelledby={id('tab', i)}
          // tabpanel focus được theo WAI-ARIA (nội dung không có phần tử tương tác)
          tabIndex={0}
          hidden={i !== current}
          className={cn('pt-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', panelClassName)}
          data-testid={`passage-panel-${i + 1}`}
        >
          {i === current ? <PassageBlocks blocks={blocks[i]!} highlight={marks} zoom={zoom} /> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Đoạn văn Part 6–7. Desktop: khung trái cuộn riêng (giữ vị trí cuộn khi chuyển câu trong cùng nhóm).
 * Mobile: nằm trên câu hỏi, thu gọn được (aria-expanded) để dành chỗ cho câu hỏi.
 * `[Nhãn]` trên một dòng → tiêu đề phụ; `[131]`/`[1]` → nhãn mốc, tô sáng mốc mà câu đang xem hỏi tới.
 * B5/S24: passage có ≥ 2 văn bản (`parts`) → tab từng văn bản (tablist nằm ngoài vùng thu gọn để luôn dùng được).
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
  const parts = React.useMemo(() => partsOf(passage), [passage]);
  const blocks = React.useMemo(() => (parts.length ? [] : parsePassage(passage.body)), [parts.length, passage.body]);
  const marks = React.useMemo(() => new Set(highlight), [highlight]);
  return (
    <section
      aria-label={passage.title ?? t('passageTitle')}
      className={cn('scroll-mt-28 rounded-xl border border-border bg-card', className)}
      data-testid="passage"
      data-collapsed={collapsed}
      data-parts={parts.length}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{passage.title ?? t('passageTitle')}</h2>
          {rangeLabel ? <p className="text-xs text-muted-foreground">{rangeLabel}</p> : null}
          {parts.length ? <p className="text-xs text-muted-foreground">{t('passageTextsHint', { count: parts.length })}</p> : null}
        </div>
        {collapsible ? (
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={!collapsed} aria-controls={bodyId} data-testid="passage-toggle">
            {collapsed ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
            {collapsed ? t('passageExpand') : t('passageCollapse')}
          </Button>
        ) : null}
      </div>
      {parts.length ? (
        <div id={bodyId}>
          <PassageTabs
            passageId={passage.id}
            parts={parts}
            highlight={highlight}
            zoom={zoom}
            className="px-5 pt-3 pb-4"
            panelClassName={cn(collapsed && 'max-h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_40%,transparent)]')}
          />
        </div>
      ) : (
        <div
          id={bodyId}
          className={cn('px-5 py-4', collapsed && 'max-h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_40%,transparent)]')}
          aria-hidden={collapsed || undefined}
        >
          <PassageBlocks blocks={blocks} highlight={marks} zoom={zoom} />
        </div>
      )}
    </section>
  );
}
