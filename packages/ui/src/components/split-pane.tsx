'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Hai khung cạnh nhau có thanh kéo đổi tỉ lệ (WAI-ARIA "window splitter"):
 * - kéo bằng chuột/cảm ứng (pointer capture), bàn phím ←/→ (bước `step`), Home/End về min/max, Enter về `defaultRatio`;
 * - `ratio` là phần của khung đầu (0–1), luôn kẹp trong [min, max];
 * - `onRatioCommit` gọi khi thả chuột/nhấn phím xong (để lưu localStorage), `onRatioChange` gọi liên tục khi kéo.
 * Nhãn a11y do nơi dùng truyền vào (i18n), component không chứa chuỗi hiển thị.
 */
export interface SplitPaneProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  start: React.ReactNode;
  end: React.ReactNode;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit?: (ratio: number) => void;
  min?: number;
  max?: number;
  step?: number;
  defaultRatio?: number;
  /** aria-label của thanh kéo */
  separatorLabel: string;
  startClassName?: string;
  endClassName?: string;
}

export function clampRatio(value: number, min = 0.25, max = 0.75): number {
  if (!Number.isFinite(value)) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

export function SplitPane({
  start,
  end,
  ratio,
  onRatioChange,
  onRatioCommit,
  min = 0.25,
  max = 0.75,
  step = 0.05,
  defaultRatio = 0.5,
  separatorLabel,
  className,
  startClassName,
  endClassName,
  style,
  ...props
}: SplitPaneProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const latestRef = React.useRef(ratio);
  const startId = React.useId();
  const value = clampRatio(ratio, min, max);

  React.useEffect(() => {
    latestRef.current = value;
  }, [value]);

  const update = (next: number) => {
    const r = clampRatio(next, min, max);
    latestRef.current = r;
    onRatioChange(r);
    return r;
  };

  const fromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    update((clientX - rect.left) / rect.width);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    fromPointer(e.clientX);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onRatioCommit?.(latestRef.current);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = value - step;
    else if (e.key === 'ArrowRight') next = value + step;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key === 'Enter') next = defaultRatio;
    if (next === null) return;
    // Không để phím mũi tên lan ra phím tắt toàn trang (ví dụ chuyển câu)
    e.preventDefault();
    e.stopPropagation();
    onRatioCommit?.(update(next));
  };

  return (
    <div
      ref={containerRef}
      data-slot="split-pane"
      className={cn('grid min-h-0', className)}
      style={{ gridTemplateColumns: `minmax(0, ${value}fr) auto minmax(0, ${1 - value}fr)`, ...style }}
      {...props}
    >
      <div id={startId} className={cn('min-h-0 min-w-0', startClassName)}>
        {start}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={separatorLabel}
        aria-controls={startId}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round(max * 100)}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={0}
        data-slot="split-pane-separator"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onRatioCommit?.(update(defaultRatio))}
        className="group relative flex w-3 cursor-col-resize touch-none items-center justify-center outline-none select-none"
      >
        <span aria-hidden className="h-full w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card shadow-sm transition-colors group-hover:border-primary group-focus-visible:border-primary group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40"
        />
      </div>
      <div className={cn('min-h-0 min-w-0', endClassName)}>{end}</div>
    </div>
  );
}
