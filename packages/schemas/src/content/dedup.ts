/**
 * Phát hiện câu trùng khi nhập hàng loạt (Sprint 2): độ tương đồng trigram theo cùng cách tính của pg_trgm
 * (chữ thường, ký tự không phải chữ/số → khoảng trắng, mỗi từ đệm 2 khoảng trắng đầu + 1 cuối; |A∩B| / |A∪B|).
 * DB dùng `similarity()` của pg_trgm cho câu đã có; hàm này dùng cho trùng lặp trong cùng một tệp nhập.
 */

export const DEFAULT_DUPLICATE_THRESHOLD = 0.85;

export function normalizeStem(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/_{2,}/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalizeStem(text).split(' ')) {
    if (!word) continue;
    const padded = `  ${word} `;
    const chars = Array.from(padded);
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(''));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface BatchDuplicate {
  /** chỉ số dòng bị coi là trùng (0-based) */
  index: number;
  /** dòng gốc mà nó trùng */
  duplicate_of: number;
  similarity: number;
}

/** Tìm dòng trùng trong cùng lô: dòng sau trùng dòng trước (≥ threshold) bị đánh dấu */
export function findBatchDuplicates(stems: readonly string[], threshold = DEFAULT_DUPLICATE_THRESHOLD): BatchDuplicate[] {
  const grams = stems.map((s) => trigrams(s));
  const dups: BatchDuplicate[] = [];
  const dupSet = new Set<number>();
  for (let i = 0; i < stems.length; i++) {
    if (dupSet.has(i)) continue;
    for (let j = i + 1; j < stems.length; j++) {
      if (dupSet.has(j)) continue;
      const A = grams[i]!;
      const B = grams[j]!;
      let inter = 0;
      for (const t of A) if (B.has(t)) inter++;
      const union = A.size + B.size - inter;
      const sim = union === 0 ? 1 : inter / union;
      if (sim >= threshold) {
        dups.push({ index: j, duplicate_of: i, similarity: Math.round(sim * 1000) / 1000 });
        dupSet.add(j);
      }
    }
  }
  return dups;
}
