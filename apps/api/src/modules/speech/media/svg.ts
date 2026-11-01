/**
 * Ảnh SVG cho nội dung (Sprint 4 – ảnh minh hoạ Part 1 tự vẽ, CMS/seed, bucket media). SVG là XML có thể chứa script,
 * trình xử lý sự kiện, tham chiếu ngoài → KHÔNG sửa/làm sạch mà TỪ CHỐI mọi nội dung chủ động (an toàn hơn sanitizer tự viết).
 * Người học không được tải SVG (ALLOWED_IMAGE_MIME); processor chặn cả SVG đổi đuôi trong bucket recordings.
 */

export const MAX_SVG_BYTES = 2 * 1024 * 1024;

/**
 * Ứng viên SVG từ phần đầu tệp (BOM/khoảng trắng → `<svg`, `<?xml`, `<!--` hoặc `<!DOCTYPE svg`).
 * Chỉ là nhận dạng sơ bộ – `inspectSvg` xác nhận phần tử gốc `<svg>` và nội dung an toàn.
 */
export function looksLikeSvg(head: Buffer): boolean {
  let text = head.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.trimStart().toLowerCase();
  return text.startsWith('<svg') || text.startsWith('<?xml') || text.startsWith('<!--') || text.startsWith('<!doctype svg');
}

export interface SvgInspection {
  ok: boolean;
  reason?: string;
  width: number | null;
  height: number | null;
}

/** Mẫu nội dung chủ động/tham chiếu ngoài bị từ chối (không phân biệt hoa thường) */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/<\s*script\b/i, 'script element'],
  [/<\s*foreignobject\b/i, 'foreignObject element'],
  [/<\s*(iframe|embed|object|audio|video|canvas|link|meta|base)\b/i, 'embedded content element'],
  [/<!entity\b/i, 'XML entity declaration'],
  [/<!doctype[^>]*\[/i, 'DOCTYPE internal subset'],
  [/\son[a-z]+\s*=/i, 'event handler attribute'],
  [/(java|vb)script\s*:/i, 'script URL'],
  [/["'(]\s*data\s*:\s*(?!image\/(png|jpeg|gif|webp)[;,])/i, 'non-image data URL'],
  [/@import\b/i, 'CSS @import'],
  [/url\(\s*['"]?\s*(?!#|data:image\/(png|jpeg|gif|webp)[;,])/i, 'external CSS url()'],
  [/\b(xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(png|jpeg|gif|webp)[;,])/i, 'external href'],
];

const num = (v: string | undefined): number | null => {
  if (!v) return null;
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(px)?\s*$/i.exec(v);
  return m ? Math.round(Number(m[1])) : null;
};

/** Kiểm tra SVG an toàn để phát qua URL ký (thẻ <img>) và lấy kích thước từ width/height hoặc viewBox */
export function inspectSvg(input: Buffer | string): SvgInspection {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  if (buf.length > MAX_SVG_BYTES) return { ok: false, reason: 'SVG too large', width: null, height: null };
  const text = buf.toString('utf8');
  const root = /<svg\b([^>]*)>/i.exec(text);
  if (!root) return { ok: false, reason: 'no <svg> root element', width: null, height: null };
  for (const [re, reason] of FORBIDDEN) if (re.test(text)) return { ok: false, reason: `SVG contains ${reason}`, width: null, height: null };
  const attrs = root[1] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs)?.[1];
  let width = num(attr('width'));
  let height = num(attr('height'));
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if ((width === null || height === null) && vb && vb.length === 4 && vb.every((x) => Number.isFinite(x))) {
    width ??= Math.round(vb[2]!);
    height ??= Math.round(vb[3]!);
  }
  return { ok: true, width, height };
}
