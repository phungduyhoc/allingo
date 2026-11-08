import { createElement as h, Fragment, type ReactNode } from 'react';
import { absoluteMediaUrl } from './client';
import { normalizeCmsHref } from './links';
import { asMedia, pickText, type LexicalNode, type LexicalRoot } from './types';

/**
 * Lexical (Payload richText) → phần tử React (render ở server ra HTML). An toàn theo cấu trúc: KHÔNG dùng innerHTML – chữ luôn là
 * text node (React tự escape), chỉ tạo các thẻ trong danh sách cho phép (p, h2–h4, ul/ol/li, blockquote, a, img, strong, em, u,
 * s, code, sub, sup, br, hr); liên kết qua `normalizeCmsHref` (chặn javascript:/data:…, thêm locale cho đường dẫn nội bộ, link
 * ngoài `rel="noopener noreferrer nofollow"`); ảnh upload chỉ khi có URL hợp lệ. Nút lạ → render nội dung con.
 * h1 trong nội dung hạ thành h2 (trang bài viết đã có h1 là tiêu đề).
 */

const FORMAT = { bold: 1, italic: 2, strikethrough: 4, underline: 8, code: 16, subscript: 32, superscript: 64 } as const;

export interface LexicalOptions {
  locale: string;
}

function renderText(node: LexicalNode, key: string): ReactNode {
  const text = typeof node.text === 'string' ? node.text : '';
  if (!text) return null;
  const f = typeof node.format === 'number' ? node.format : 0;
  let el: ReactNode = text;
  if (f & FORMAT.code) el = h('code', null, el);
  if (f & FORMAT.bold) el = h('strong', null, el);
  if (f & FORMAT.italic) el = h('em', null, el);
  if (f & FORMAT.underline) el = h('u', null, el);
  if (f & FORMAT.strikethrough) el = h('s', null, el);
  if (f & FORMAT.subscript) el = h('sub', null, el);
  if (f & FORMAT.superscript) el = h('sup', null, el);
  return h(Fragment, { key }, el);
}

function children(node: LexicalNode, opts: LexicalOptions, key: string): ReactNode[] {
  return (node.children ?? []).map((c, i) => renderNode(c, opts, `${key}.${i}`));
}

const HEADINGS = new Set(['h2', 'h3', 'h4']);

export function renderNode(node: LexicalNode, opts: LexicalOptions, key = '0'): ReactNode {
  if (!node || typeof node !== 'object') return null;
  switch (node.type) {
    case 'root':
      return h(Fragment, { key }, ...children(node, opts, key));
    case 'text':
      return renderText(node, key);
    case 'linebreak':
      return h('br', { key });
    case 'tab':
      return h(Fragment, { key }, ' ');
    case 'paragraph': {
      const kids = children(node, opts, key);
      return kids.length ? h('p', { key }, ...kids) : null;
    }
    case 'heading': {
      const tag = typeof node.tag === 'string' && HEADINGS.has(node.tag) ? node.tag : node.tag === 'h1' ? 'h2' : 'h4';
      return h(tag, { key }, ...children(node, opts, key));
    }
    case 'quote':
      return h('blockquote', { key }, ...children(node, opts, key));
    case 'list':
      return h(node.listType === 'number' || node.tag === 'ol' ? 'ol' : 'ul', { key }, ...children(node, opts, key));
    case 'listitem':
      return h('li', { key }, ...children(node, opts, key));
    case 'horizontalrule':
      return h('hr', { key });
    case 'link':
    case 'autolink': {
      const raw = node.fields?.url ?? (typeof node.url === 'string' ? node.url : null);
      const safe = normalizeCmsHref(raw, opts.locale);
      const kids = children(node, opts, key);
      if (!safe) return h(Fragment, { key }, ...kids);
      const ext = safe.external || node.fields?.newTab === true;
      return h('a', { key, href: safe.href, ...(ext ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {}) }, ...kids);
    }
    case 'upload': {
      const media = asMedia(node.value);
      const src = absoluteMediaUrl(media?.url);
      if (!media || !src) return null;
      const alt = pickText(media.alt, opts.locale);
      return h('figure', { key }, h('img', { src, alt, width: media.width ?? undefined, height: media.height ?? undefined, loading: 'lazy', decoding: 'async' }), alt ? h('figcaption', { className: 'mt-2 text-sm text-muted-foreground' }, alt) : null);
    }
    default:
      return node.children?.length ? h(Fragment, { key }, ...children(node, opts, key)) : null;
  }
}

export function renderLexical(doc: LexicalRoot | null | undefined, opts: LexicalOptions): ReactNode {
  if (!doc?.root) return null;
  return renderNode(doc.root, opts, 'r');
}

/** Văn bản thuần (ước tính thời gian đọc, mô tả dự phòng) */
export function lexicalPlainText(doc: LexicalRoot | null | undefined): string {
  const out: string[] = [];
  const walk = (n: LexicalNode) => {
    if (typeof n.text === 'string') out.push(n.text);
    for (const c of n.children ?? []) walk(c);
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listitem') out.push(' ');
  };
  if (doc?.root) walk(doc.root);
  return out.join('').replace(/\s+/g, ' ').trim();
}

/** Mục lục: tiêu đề h2 của bài */
export function lexicalHeadings(doc: LexicalRoot | null | undefined): string[] {
  return (doc?.root.children ?? []).filter((n) => n.type === 'heading' && (n.tag === 'h2' || n.tag === 'h1')).map((n) => lexicalPlainText({ root: n })).filter(Boolean);
}
