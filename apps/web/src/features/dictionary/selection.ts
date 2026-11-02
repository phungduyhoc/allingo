import { DICTIONARY_CONTEXT_MAX, DICTIONARY_QUERY_MAX } from '@allingo/schemas';

/**
 * Chọn từ/cụm trong đoạn văn, đề bài, transcript → mục tra (thuần – có test).
 * - 1 từ → tra từ; 2–4 từ → tra cụm (từ điển có thể có collocation, không có → AI); > 4 từ → dịch câu (AI).
 * - `context` = câu chứa vùng chọn (≤ 300 ký tự, cắt quanh vùng chọn) để API/AI chọn nghĩa đúng; dịch câu không gửi context.
 * - Bỏ dấu câu/ngoặc ở hai đầu, gộp khoảng trắng, ô trống `______` → `___`; vùng chọn không có chữ cái hoặc quá dài (> 500) → null.
 */

export type LookupMode = 'word' | 'phrase' | 'sentence';

export interface LookupTarget {
  term: string;
  context: string | null;
  mode: LookupMode;
  wordCount: number;
}

/** Số từ tối đa của "cụm" – nhiều hơn là câu (dịch AI) */
export const PHRASE_MAX_WORDS = 4;

const EDGE_PUNCT = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function cleanSelection(raw: string): string {
  return raw.normalize('NFKC').replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim().replace(EDGE_PUNCT, '');
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Câu (trong `block`) chứa vị trí `offset`; cắt ≤ `max` ký tự quanh vùng chọn */
export function sentenceAround(block: string, offset: number, length: number, max = DICTIONARY_CONTEXT_MAX): string {
  const text = block.replace(/\s+/g, ' ');
  // offset tính trên chuỗi gốc – ánh xạ gần đúng sau khi gộp khoảng trắng
  const ratio = block.length ? text.length / block.length : 1;
  const at = Math.min(text.length, Math.max(0, Math.round(offset * ratio)));
  const end0 = Math.min(text.length, at + Math.max(1, Math.round(length * ratio)));
  const boundary = /[.!?。！？]\s|\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text)) && m.index < at) start = m.index + m[0].length;
  boundary.lastIndex = end0;
  const next = boundary.exec(text);
  const end = next ? next.index + 1 : text.length;
  let s = text.slice(start, end).trim();
  if (s.length > max) {
    const rel = at - start;
    const from = Math.max(0, Math.min(s.length - max, rel - Math.floor((max - (end0 - at)) / 2)));
    s = s.slice(from, from + max).trim();
  }
  return s;
}

export function toLookupTarget(selected: string, block?: string | null, offset?: number): LookupTarget | null {
  const term = cleanSelection(selected).replace(/_{3,}/g, '___');
  if (!term || !/\p{L}/u.test(term) || term.length > DICTIONARY_QUERY_MAX) return null;
  // Chỉ có một từ cạnh ô trống (vd. "______ the") → bỏ ô trống
  if (countWords(term.replace(/_{3}/g, ' ')) <= 1 && term.includes('___'))
    return toLookupTarget(term.replace(/_{3}/g, ' '), block, offset);
  const wordCount = countWords(term);
  const mode: LookupMode = wordCount <= 1 ? 'word' : wordCount <= PHRASE_MAX_WORDS ? 'phrase' : 'sentence';
  let context: string | null = null;
  if (mode !== 'sentence' && block) {
    const idx = typeof offset === 'number' && offset >= 0 ? offset : block.indexOf(selected.trim());
    const ctx = sentenceAround(block, Math.max(0, idx), selected.length);
    context = ctx && ctx.toLowerCase() !== term.toLowerCase() ? ctx : null;
  }
  return { term, context, mode, wordCount };
}

/** Khoá ổn định cho cache truy vấn (term chuẩn hoá chữ thường) */
export const lookupKey = (t: Pick<LookupTarget, 'term' | 'context' | 'mode'>) =>
  [t.mode, t.term.toLowerCase(), t.context ?? ''] as const;
