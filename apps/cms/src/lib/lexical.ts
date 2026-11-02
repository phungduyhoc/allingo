/**
 * Dựng Lexical SerializedEditorState (richText Payload) từ khối đơn giản – dùng cho seed bài blog tự viết (Sprint 10).
 * Hỗ trợ h2/h3/đoạn/danh sách và **in đậm** trong dòng.
 */
export type LexicalBlock = { h2: string } | { h3: string } | { p: string } | { ul: string[] } | { ol: string[] } | { quote: string };

interface TextNode {
  type: 'text';
  text: string;
  format: number;
  detail: 0;
  mode: 'normal';
  style: '';
  version: 1;
}

const base = { direction: 'ltr' as const, format: '' as const, indent: 0, version: 1 as const };

export function inlineText(s: string): TextNode[] {
  const parts = s.split(/(\*\*[^*]+\*\*)/g).filter((x) => x.length > 0);
  return parts.map((p) => {
    const bold = p.startsWith('**') && p.endsWith('**') && p.length > 4;
    return { type: 'text', text: bold ? p.slice(2, -2) : p, format: bold ? 1 : 0, detail: 0, mode: 'normal', style: '', version: 1 };
  });
}

export function lexical(blocks: readonly LexicalBlock[]) {
  const children = blocks.map((b) => {
    if ('h2' in b) return { type: 'heading', tag: 'h2', children: inlineText(b.h2), ...base };
    if ('h3' in b) return { type: 'heading', tag: 'h3', children: inlineText(b.h3), ...base };
    if ('quote' in b) return { type: 'quote', children: inlineText(b.quote), ...base };
    if ('ul' in b || 'ol' in b) {
      const items = 'ul' in b ? b.ul : b.ol;
      const ordered = 'ol' in b;
      return { type: 'list', listType: ordered ? 'number' : 'bullet', start: 1, tag: ordered ? 'ol' : 'ul', children: items.map((t, i) => ({ type: 'listitem', value: i + 1, children: inlineText(t), ...base })), ...base };
    }
    return { type: 'paragraph', textFormat: 0, textStyle: '', children: inlineText(b.p), ...base };
  });
  return { root: { type: 'root', children, ...base } };
}

/** Văn bản thuần (đếm chữ / phút đọc) */
export function plainText(blocks: readonly LexicalBlock[]): string {
  return blocks.map((b) => ('h2' in b ? b.h2 : 'h3' in b ? b.h3 : 'p' in b ? b.p : 'quote' in b ? b.quote : 'ul' in b ? b.ul.join(' ') : b.ol.join(' '))).join(' ').replace(/\*\*/g, '');
}

/** Phút đọc ước tính (~200 từ/phút, tối thiểu 1) */
export function readingMinutes(blocks: readonly LexicalBlock[]): number {
  return Math.max(1, Math.round(plainText(blocks).split(/\s+/).filter(Boolean).length / 200));
}
