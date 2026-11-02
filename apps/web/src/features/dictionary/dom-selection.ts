/**
 * Đọc vùng chọn của trình duyệt trong một vùng cho phép tra từ (`[data-lookup]`: đoạn văn, đề bài, transcript…).
 * Trả chữ đã chọn, khối văn bản chứa nó (để lấy câu ngữ cảnh), vị trí trong khối và khung chữ nhật để đặt popover.
 */

export const LOOKUP_ZONE_SELECTOR = '[data-lookup]';
const BLOCK_SELECTOR = 'p,li,dd,blockquote,h2,h3,h4,td,th,[data-lookup-block]';

export interface DomSelection {
  selected: string;
  block: string;
  offset: number;
  rect: { top: number; left: number; bottom: number; right: number; width: number; height: number };
  /** Vị trí cuộn trang lúc chọn – cùng thời điểm với `rect` (tránh lệch khi trang đang cuộn mượt) */
  scroll: { x: number; y: number };
  zone: HTMLElement;
}

const elementOf = (n: Node | null): Element | null =>
  n ? (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement) : null;

export function zoneOf(node: Node | null): HTMLElement | null {
  const el = elementOf(node);
  const zone = el?.closest<HTMLElement>(LOOKUP_ZONE_SELECTOR) ?? null;
  // Vùng tắt tạm (vd. đang thi) đánh dấu data-lookup="off"
  return zone && zone.dataset.lookup !== 'off' ? zone : null;
}

export function readDomSelection(
  sel: Selection | null = typeof window !== 'undefined' ? window.getSelection() : null,
): DomSelection | null {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const selected = sel.toString();
  if (!selected.trim()) return null;
  const zone = zoneOf(range.startContainer);
  // Vùng chọn phải nằm gọn trong MỘT vùng tra từ (không kéo sang lựa chọn đáp án/nút)
  if (!zone || zoneOf(range.endContainer) !== zone) return null;
  const blockEl = elementOf(range.startContainer)?.closest<HTMLElement>(BLOCK_SELECTOR);
  const container = blockEl && zone.contains(blockEl) ? blockEl : zone;
  let offset = 0;
  try {
    const pre = document.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.startContainer, range.startOffset);
    offset = pre.toString().length;
  } catch {
    offset = -1;
  }
  const r = range.getBoundingClientRect();
  return {
    selected,
    block: container.textContent ?? '',
    offset,
    rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height },
    scroll: { x: window.scrollX, y: window.scrollY },
    zone,
  };
}

/** Vị trí popover (toạ độ trang, `position: absolute`): dưới vùng chọn, lật lên trên khi thiếu chỗ, kẹp trong viewport */
export function popoverPosition(
  rect: DomSelection['rect'],
  size: { width: number; height: number },
  viewport: { width: number; height: number; scrollX: number; scrollY: number },
  gap = 8,
): { top: number; left: number; placement: 'below' | 'above' } {
  const margin = 8;
  const below = rect.bottom + gap + size.height <= viewport.height - margin || rect.top - gap - size.height < margin;
  const topVp = below ? rect.bottom + gap : rect.top - gap - size.height;
  const center = rect.left + rect.width / 2;
  const leftVp = Math.min(
    Math.max(margin, center - size.width / 2),
    Math.max(margin, viewport.width - size.width - margin),
  );
  return {
    top: Math.round(topVp + viewport.scrollY),
    left: Math.round(leftVp + viewport.scrollX),
    placement: below ? 'below' : 'above',
  };
}
