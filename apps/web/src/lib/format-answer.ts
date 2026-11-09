/** Hiển thị gọn một đáp án (của người học hoặc đáp án đúng) dạng chuỗi: "B", "A, C", "s1: true; s2: false"… */
export function formatAnswer(a: unknown): string {
  if (a === null || a === undefined) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.map(formatAnswer).join(', ');
  if (typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if ('selected' in o) return formatAnswer(o.selected);
    if ('values' in o) return formatAnswer(o.values);
    if ('blanks' in o) return formatAnswer(o.blanks);
    // C2: nối (pairs), điền từ / ngân hàng từ (gaps)
    if ('pairs' in o) return formatAnswer(o.pairs);
    if ('gaps' in o) return formatAnswer(o.gaps);
    return Object.entries(o)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).map(String).join('/') : String(v)}`)
      .join('; ');
  }
  return typeof a === 'number' || typeof a === 'boolean' ? String(a) : '';
}
