/**
 * Từ điển lõi TOEIC Anh–Việt của Allingo (Allingo TOEIC Core EN–VI).
 *
 * Nội dung TỰ BIÊN SOẠN hoàn toàn (giấy phép: nội dung riêng của Allingo), không sao chép từ điển có bản quyền.
 * Câu ví dụ tự viết theo ngữ cảnh công sở/TOEIC; mọi tên người, công ty, địa danh trong ví dụ đều hư cấu.
 *
 * Phạm vi: từ đơn + cụm từ/phrasal verb thường gặp trong TOEIC (10 topic của seed core), ưu tiên toàn bộ từ nội dung
 * xuất hiện trong ngân hàng câu demo (`seed/demo/toeic-reading-01.ts`, `toeic-listening-01.ts`, `content.ts`).
 *
 * Quy ước dữ liệu (dùng cho importer `catalog.vocab_items`):
 * - Cùng headword khác loại từ là hai mục riêng (vd `record` noun/verb); khoá duy nhất = (headword, pos).
 * - `headword` chữ thường, dạng gốc; `forms` chỉ chứa biến thể biến tố (số nhiều, thì, so sánh, chính tả Anh–Mỹ)
 *   để tra ngược – một form có thể thuộc nhiều mục (`orders` → order noun + order verb).
 * - IPA kiểu từ điển học tập: Mỹ dùng /ɑː oʊ ɜːr ər/, Anh dùng /ɒ əʊ ɜː ə/; từ một âm tiết không ghi dấu trọng âm.
 * - `meanings[0]` là nghĩa hay gặp nhất trong TOEIC; `level` theo CEFR ước lượng cho người học Việt Nam.
 *
 * Dữ liệu chia theo chữ cái đầu ở `entries-*.ts` (gộp tại đây); khi sửa, giữ thứ tự chữ cái theo headword rồi loại từ.
 */

import { ENTRIES_A_C } from './entries-a-c.js';
import { ENTRIES_D_H } from './entries-d-h.js';
import { ENTRIES_I_O } from './entries-i-o.js';
import { ENTRIES_P_R } from './entries-p-r.js';
import { ENTRIES_S_Z } from './entries-s-z.js';

export type DictPos =
  'noun' | 'verb' | 'adjective' | 'adverb' | 'preposition' | 'conjunction' | 'phrase' | 'phrasal_verb';

export interface DictEntry {
  /** Chữ thường, dạng gốc (trừ từ riêng bắt buộc viết hoa) */
  headword: string;
  pos: DictPos;
  /** IPA giọng Mỹ, có dấu gạch chéo, vd '/ˈɪnvɔɪs/' */
  ipa_us: string;
  /** IPA giọng Anh */
  ipa_uk: string;
  /** 1–3 nghĩa, nghĩa TOEIC trước */
  meanings: Array<{ vi: string; en: string }>;
  /** 1–2 câu ví dụ tự viết, ngữ cảnh công sở */
  examples: Array<{ en: string; vi: string }>;
  /** 0–4 kết hợp từ thường gặp */
  collocations: string[];
  level: 'A2' | 'B1' | 'B2' | 'C1';
  /** Mã topic trong catalog.topics (seed core) */
  topics: string[];
  /** Biến thể để tra ngược: số nhiều, thì, so sánh */
  forms: string[];
}

/** Mã topic hợp lệ – khớp catalog.topics trong seed core */
export const DICTIONARY_TOPICS = [
  'business',
  'office',
  'travel',
  'shopping',
  'logistics',
  'hr',
  'finance',
  'technology',
  'health',
  'education',
] as const;

/** Toàn bộ mục từ điển, sắp theo headword (chữ cái) rồi loại từ */
export const DICTIONARY_TOEIC_CORE: DictEntry[] = [
  ...ENTRIES_A_C,
  ...ENTRIES_D_H,
  ...ENTRIES_I_O,
  ...ENTRIES_P_R,
  ...ENTRIES_S_Z,
];

export const DICTIONARY_LICENSE: { name: string; license: string; version: string; entries: number } = {
  name: 'Allingo TOEIC Core EN–VI',
  license: 'Proprietary – Allingo content (tự biên soạn)',
  version: '1.0',
  entries: DICTIONARY_TOEIC_CORE.length,
};

/**
 * Chuẩn hoá chuỗi tra cứu: NFKC, chữ thường, ’/‘ → ', các loại gạch nối → '-', gộp khoảng trắng, bỏ dấu câu ở đầu/cuối.
 * Giữ dấu nháy và gạch nối bên trong từ (`o'clock`, `e-mail`, `follow-up`). Tương thích `normalizeLookupTerm` của API
 * (`@allingo/schemas`) với mọi headword/form trong từ điển này.
 */
export function normalizeTerm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[’‘ʼ′]/g, "'")
    .replace(/[‐-―]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Chỉ mục tra ngược: headword/form đã normalize → chỉ số mục trong `entries`.
 * Một form có thể thuộc nhiều mục khác loại từ (`orders` → order noun + order verb), thứ tự chỉ số tăng dần.
 */
export function buildFormIndex(entries: readonly DictEntry[] = DICTIONARY_TOEIC_CORE): Map<string, number[]> {
  const index = new Map<string, number[]>();
  entries.forEach((entry, i) => {
    const keys = new Set([entry.headword, ...entry.forms].map(normalizeTerm).filter((k) => k !== ''));
    for (const key of keys) {
      const list = index.get(key);
      if (list) list.push(i);
      else index.set(key, [i]);
    }
  });
  return index;
}
