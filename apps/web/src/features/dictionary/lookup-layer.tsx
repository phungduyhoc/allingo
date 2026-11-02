'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useMediaQuery } from '@/lib/use-media-query';
import { popoverPosition, readDomSelection } from './dom-selection';
import { toLookupTarget, type LookupTarget } from './selection';

const LookupCard = dynamic(() => import('./lookup-card').then((m) => m.LookupCard), { ssr: false });

export interface LookupSource {
  type: 'review' | 'passage';
  attemptId?: string;
}

interface Opened {
  target: LookupTarget;
  rect: { top: number; left: number; bottom: number; right: number; width: number; height: number };
  scroll: { x: number; y: number };
  seq: number;
}

const POPOVER_WIDTH = 352;

/**
 * Lớp tra từ cho một trang (Review, Practice): nhấp đúp / bôi đen (desktop) hoặc chạm giữ (mobile – theo `selectionchange`)
 * trong vùng `[data-lookup]` → popover tra từ đặt cạnh vùng chọn (mobile: tấm dưới đáy). `enabled = false` (Exam Mode,
 * đang thi ở nơi khác) → không lắng nghe, popover không mở.
 */
export function LookupLayer({ enabled, source }: { enabled: boolean; source: LookupSource }) {
  const t = useTranslations('dictionary');
  const [opened, setOpened] = React.useState<Opened | null>(null);
  const [size, setSize] = React.useState({ width: POPOVER_WIDTH, height: 320 });
  const narrow = useMediaQuery('(max-width: 639px)');
  const coarse = useMediaQuery('(pointer: coarse)');
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const lastKey = React.useRef<{ key: string; at: number } | null>(null);
  const seq = React.useRef(0);

  const openFromSelection = React.useCallback(() => {
    const sel = readDomSelection();
    if (!sel) return;
    const target = toLookupTarget(sel.selected, sel.block, sel.offset);
    if (!target) return;
    // dblclick + mouseup + selectionchange có thể cùng báo một vùng chọn → bỏ trùng trong 400 ms
    const key = `${target.term}|${Math.round(sel.rect.top)}|${Math.round(sel.rect.left)}`;
    const now = Date.now();
    if (lastKey.current && lastKey.current.key === key && now - lastKey.current.at < 400) return;
    lastKey.current = { key, at: now };
    seq.current += 1;
    setOpened({ target, rect: sel.rect, scroll: sel.scroll, seq: seq.current });
  }, []);

  const close = React.useCallback(() => setOpened(null), []);

  // Tắt (vào Exam Mode) → đóng popover đang mở
  const [prevEnabled, setPrevEnabled] = React.useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    if (!enabled) setOpened(null);
  }

  React.useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const later = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(openFromSelection, ms);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || cardRef.current?.contains(e.target as Node)) return;
      later(10);
    };
    const onDblClick = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      later(0);
    };
    // Mobile: chạm giữ chọn từ → selectionchange (chờ người học kéo xong tay cầm chọn)
    const onSelectionChange = () => {
      if (!coarse) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      later(650);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // Bàn phím: chọn bằng Shift+mũi tên rồi thả Shift
      if (e.key === 'Shift') later(10);
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('dblclick', onDblClick);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('dblclick', onDblClick);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [coarse, enabled, openFromSelection]);

  // Đóng: Esc, chạm ra ngoài, đổi kích thước cửa sổ
  React.useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', close);
    };
  }, [close, opened]);

  // Đo kích thước thật của popover để lật lên/xuống đúng
  React.useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !opened || narrow) return;
    const ro = new ResizeObserver(() => setSize({ width: el.offsetWidth, height: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow, opened]);

  if (!enabled || !opened) return null;
  const pos = narrow
    ? null
    : popoverPosition(opened.rect, size, {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: opened.scroll.x,
        scrollY: opened.scroll.y,
      });
  // Portal vào body: toạ độ `absolute` tính theo trang, không phụ thuộc phần tử cha có position
  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-label={t('dialogLabel', {
        term: opened.target.term.length > 40 ? `${opened.target.term.slice(0, 40)}…` : opened.target.term,
      })}
      className={
        narrow
          ? 'fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-2xl'
          : 'absolute z-50 max-h-[min(28rem,70vh)] w-[22rem] overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl'
      }
      style={pos ? { top: pos.top, left: pos.left } : undefined}
      data-testid="lookup-popover"
      data-placement={pos?.placement ?? 'sheet'}
      data-mode={opened.target.mode}
    >
      <LookupCard key={opened.seq} target={opened.target} source={source} onClose={close} />
    </div>,
    document.body,
  );
}
