/**
 * Định dạng đoạn văn Part 6–7 (văn bản thuần từ CMS/seed):
 * - dòng chỉ gồm `[Nhãn]` (không phải số) = tiêu đề phụ của từng văn bản trong bộ nhiều đoạn (Part 7 double/triple),
 *   ví dụ `[E-mail]`, `[Booking summary]`;
 * - `[131]` (chỗ trống Part 6) và `[1]`–`[4]` (vị trí chèn câu Part 7) = mốc, hiển thị dạng nhãn và tô sáng
 *   khi đề bài của câu đang xem nhắc tới.
 */

export type PassageSegment = { kind: 'text'; text: string } | { kind: 'marker'; id: string };
export type PassageBlock = { kind: 'heading'; text: string } | { kind: 'paragraph'; segments: PassageSegment[] };

const HEADING_RE = /^\s*\[([^\]\d][^\]]{0,80})\]\s*$/;
const MARKER_RE = /\[(\d{1,3})\]/g;

function segmentsOf(text: string): PassageSegment[] {
  const out: PassageSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'marker', id: m[1]! });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** Tách đoạn văn thành tiêu đề phụ + đoạn (giữ xuống dòng trong đoạn; ngăn đoạn bằng dòng trống) */
export function parsePassage(body: string | null | undefined): PassageBlock[] {
  if (!body) return [];
  const blocks: PassageBlock[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').replace(/^\n+|\n+$/g, '');
    if (text.trim()) blocks.push({ kind: 'paragraph', segments: segmentsOf(text) });
    buffer = [];
  };
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1]!.trim() });
    } else if (!line.trim()) {
      flush();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

/** Mốc `[n]` được nhắc trong đề bài câu đang xem (ví dụ "blank [131]" → ['131']) */
export function markersInStem(stem: string | null | undefined): string[] {
  if (!stem) return [];
  return [...new Set([...stem.matchAll(MARKER_RE)].map((m) => m[1]!))];
}
