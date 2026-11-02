/**
 * Markdown ngắn AN TOÀN cho câu trả lời gia sư và ghi chú người học: dựng cây khối/inline thuần (không HTML, không
 * dangerouslySetInnerHTML). Hỗ trợ đoạn văn, tiêu đề (#…###), danh sách (-, *, +, 1.), trích dẫn (>), khối mã (```),
 * **đậm**, *nghiêng* hoặc _nghiêng_, `mã`, [liên kết](https://…) – chỉ http/https/đường dẫn tương đối; giao thức khác → chữ thường.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'br' };

export type Block =
  | { kind: 'p'; inline: Inline[] }
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'ol'; start: number; items: Inline[][] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'code'; text: string };

const INLINE_RE =
  /(\*\*(?=\S)[\s\S]*?\S\*\*|__(?=\S)[\s\S]*?\S__|`[^`\n]+`|\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))+\)|\*(?=\S)[^*\n]*?\S\*|(?<![\p{L}\p{N}])_(?=\S)[^_\n]*?\S_(?![\p{L}\p{N}])|\*(?=\S)\S\*)/u;

/** Liên kết an toàn: http(s) tuyệt đối hoặc đường dẫn tương đối một gạch (`/notes`); còn lại null */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\/[^\s]+$/i.test(href)) return href;
  if (/^\/(?!\/)[^\s]*$/.test(href)) return href;
  return null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m || m.index === undefined) {
      pushText(out, rest);
      break;
    }
    if (m.index > 0) pushText(out, rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__'))
      out.push({ kind: 'strong', children: parseInline(tok.slice(2, -2)) });
    else if (tok.startsWith('`')) out.push({ kind: 'code', text: tok.slice(1, -1) });
    else if (tok.startsWith('[')) {
      const close = tok.indexOf('](');
      const label = tok.slice(1, close);
      const href = safeHref(tok.slice(close + 2, -1));
      if (href) out.push({ kind: 'link', href, children: parseInline(label) });
      else pushText(out, label);
    } else out.push({ kind: 'em', children: parseInline(tok.slice(1, -1)) });
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

function pushText(out: Inline[], text: string) {
  // Xuống dòng đơn trong đoạn → <br>
  const parts = text.split('\n');
  parts.forEach((p, i) => {
    if (i > 0) out.push({ kind: 'br' });
    if (!p) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += p;
    else out.push({ kind: 'text', text: p });
  });
}

const UL_RE = /^\s{0,3}[-*+]\s+(.*)$/;
const OL_RE = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const H_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const Q_RE = /^\s{0,3}>\s?(.*)$/;
const FENCE_RE = /^\s{0,3}```/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', inline: parseInline(para.join('\n').trim()) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    if (FENCE_RE.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const h = H_RE.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: 'heading', level: Math.min(3, h[1]!.length) as 1 | 2 | 3, inline: parseInline(h[2]!) });
      continue;
    }
    if (UL_RE.test(line) || OL_RE.test(line)) {
      flush();
      const ordered = OL_RE.test(line);
      const items: Inline[][] = [];
      const start = ordered ? Number(OL_RE.exec(line)![1]) : 1;
      while (i < lines.length) {
        const l = lines[i]!;
        const m = ordered ? OL_RE.exec(l) : UL_RE.exec(l);
        if (m) {
          items.push(parseInline((ordered ? m[2] : m[1])!.trim()));
          i++;
          continue;
        }
        // Dòng tiếp nối thụt lề của mục trước
        if (l.trim() && /^\s{2,}/.test(l) && items.length) {
          const last = items[items.length - 1]!;
          last.push({ kind: 'br' }, ...parseInline(l.trim()));
          i++;
          continue;
        }
        break;
      }
      i--;
      blocks.push(ordered ? { kind: 'ol', start, items } : { kind: 'ul', items });
      continue;
    }
    const q = Q_RE.exec(line);
    if (q) {
      flush();
      const body: string[] = [q[1]!];
      while (i + 1 < lines.length && Q_RE.test(lines[i + 1]!)) body.push(Q_RE.exec(lines[++i]!)![1]!);
      blocks.push({ kind: 'quote', inline: parseInline(body.join('\n').trim()) });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Văn bản thuần (bỏ ký hiệu Markdown) – dùng cho tóm tắt/aria-label/tìm kiếm cục bộ */
export function markdownToText(src: string): string {
  const inline = (xs: Inline[]): string =>
    xs
      .map((x) => (x.kind === 'text' || x.kind === 'code' ? x.text : x.kind === 'br' ? ' ' : inline(x.children)))
      .join('');
  return parseMarkdown(src)
    .map((b) =>
      b.kind === 'code'
        ? b.text
        : b.kind === 'ul' || b.kind === 'ol'
          ? b.items.map(inline).join(' · ')
          : inline(b.inline),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
