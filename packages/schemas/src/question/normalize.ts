import { usSpellingText } from './spelling.js';
import type { WordLimit } from './rl-types.js';

/**
 * C2 – chuẩn hoá đáp án gõ tay (IELTS điền từ, trả lời ngắn, gán nhãn sơ đồ). Hàm thuần, dùng chung API (chấm), web mock và CMS.
 * Quy tắc (ASSUMPTIONS A246):
 *  1. NFC; gạch nối/ngang các kiểu (‐ – —) → "-"; nháy cong → nháy thẳng; khoảng trắng (kể cả NBSP) gộp một.
 *  2. Bỏ dấu câu bao quanh (. , ; : ! ? " ' ( ) [ ]) ở đầu/cuối cả câu trả lời và dấu câu cuối mỗi từ – "library." = "library".
 *  3. Không phân biệt hoa thường (trừ `case_sensitive`).
 *  4. Số: bỏ dấu phân cách hàng nghìn giữa các chữ số ("1,500" = "1500").
 *  5. Chính tả Anh/Mỹ chỉ khi khai báo `spelling_variants` (spelling.ts).
 *  6. Đáp án chấp nhận có phần tuỳ chọn trong ngoặc: "(the) main entrance" = "main entrance" | "the main entrance".
 *  7. Vượt giới hạn từ → sai dù có chứa đáp án (đúng quy định chấm IELTS).
 */

const DASHES = /[‐-―−]/g;
const QUOTES_SINGLE = /[‘’‚‛′]/g;
const QUOTES_DOUBLE = /[“”„‟″]/g;
const EDGE_PUNCT = /^[\s.,;:!?"'()[\]{}]+|[\s.,;:!?"'()[\]{}]+$/g;
const TRAILING_WORD_PUNCT = /(?<=\p{L}|\d)[.,;:!?]+(?=\s|$)/gu;

export interface GapNormalizeOptions {
  caseSensitive?: boolean;
  spellingVariants?: boolean;
}

/** Chuẩn hoá một câu trả lời/đáp án về dạng so sánh được */
export function normalizeGapAnswer(raw: string, opts: GapNormalizeOptions = {}): string {
  let s = raw.normalize('NFC').replace(DASHES, '-').replace(QUOTES_SINGLE, "'").replace(QUOTES_DOUBLE, '"').replace(/\s+/gu, ' ').trim();
  s = s.replace(EDGE_PUNCT, '').replace(TRAILING_WORD_PUNCT, '');
  // "1,500" → "1500" (chỉ dấu phẩy giữa chữ số, nhóm 3)
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  s = s.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  if (!opts.caseSensitive) s = s.toLocaleLowerCase();
  if (opts.spellingVariants) s = usSpellingText(s);
  return s;
}

/**
 * Mở rộng đáp án có phần tuỳ chọn trong ngoặc tròn: "(the) (old) bridge" → 4 biến thể. Tối đa 4 cụm tuỳ chọn (16 biến thể);
 * dấu ngoặc không cân → giữ nguyên chuỗi.
 */
export function expandAccepted(accepted: string): string[] {
  const parts = accepted.split(/(\([^()]*\))/g).filter((p) => p.length > 0);
  const optional = parts.filter((p) => /^\(.*\)$/.test(p));
  if (!optional.length || optional.length > 4 || /[()]/.test(parts.filter((p) => !/^\(.*\)$/.test(p)).join(''))) return [accepted];
  let out = [''];
  for (const p of parts) {
    if (/^\(.*\)$/.test(p)) {
      const inner = p.slice(1, -1);
      out = out.flatMap((prefix) => [prefix, `${prefix}${inner}`]);
    } else out = out.map((prefix) => prefix + p);
  }
  return [...new Set(out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

/** Token là một "số" theo quy ước IELTS (chữ số, có thể kèm đơn vị tiền/%, giờ 7.30, ngày 15/8, số thứ tự 21st) */
export function isNumberToken(token: string): boolean {
  return /^[£$€¥₫]?\d[\d.,:/]*(?:%|st|nd|rd|th|am|pm|k|m)?$/i.test(token);
}

export interface WordCount {
  words: number;
  numbers: number;
  tokens: number;
}

/** Đếm từ/số của câu trả lời (tách theo khoảng trắng; từ có gạch nối tính một từ) */
export function countWords(raw: string): WordCount {
  const tokens = normalizeGapAnswer(raw, { caseSensitive: true }).split(' ').filter(Boolean);
  const numbers = tokens.filter(isNumberToken).length;
  return { words: tokens.length - numbers, numbers, tokens: tokens.length };
}

/** Câu trả lời nằm trong giới hạn từ? (không có giới hạn → luôn true) */
export function withinWordLimit(raw: string, limit: WordLimit | undefined): boolean {
  if (!limit) return true;
  const c = countWords(raw);
  if (c.tokens === 0) return true;
  if (limit.number_only) return c.tokens === 1 && c.numbers === 1;
  const max = limit.max_words ?? Number.POSITIVE_INFINITY;
  if (limit.allow_number) return c.words <= max && c.numbers <= 1;
  return c.tokens <= max;
}

/** So khớp một câu trả lời với danh sách đáp án chấp nhận (đã mở rộng phần tuỳ chọn) */
export function matchesAccepted(raw: string, accepted: readonly string[], opts: GapNormalizeOptions = {}): boolean {
  const given = normalizeGapAnswer(raw, opts);
  if (!given) return false;
  return accepted.some((acc) => expandAccepted(acc).some((variant) => normalizeGapAnswer(variant, opts) === given));
}
