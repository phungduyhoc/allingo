/**
 * PDF tối thiểu tự dựng (Sprint 8 – chỉ cho MockEInvoiceProvider, không thêm thư viện): PDF 1.4 một trang A4, font chuẩn
 * Helvetica/Helvetica-Bold (WinAnsi), bảng xref tính offset đúng byte. Văn bản ASCII (đã bỏ dấu tiếng Việt – font chuẩn không có
 * glyph tiếng Việt). Hoá đơn thật do nhà cung cấp (MISA) sinh PDF có chữ ký số.
 */
export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Toạ độ x (pt, mặc định lề trái 50) */
  x?: number;
  /** Khoảng cách dòng trước (pt) */
  gap?: number;
}

function escapePdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7e]/g, '?');
}

export function buildSimplePdf(lines: PdfLine[], meta: { title: string; producer?: string } = { title: 'Document' }): Buffer {
  let y = 800;
  const ops: string[] = [];
  for (const l of lines) {
    const size = l.size ?? 10;
    y -= l.gap ?? size + 6;
    if (y < 40) break;
    ops.push(`BT /${l.bold ? 'F2' : 'F1'} ${size} Tf ${l.x ?? 50} ${y} Td (${escapePdfText(l.text)}) Tj ET`);
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Title (${escapePdfText(meta.title)}) /Producer (${escapePdfText(meta.producer ?? 'Allingo')}) >>`,
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Kiểm tra cấu trúc PDF tối thiểu (test): header, EOF, startxref trỏ đúng bảng xref, offset từng object đúng */
export function isStructurallyValidPdf(buf: Buffer): boolean {
  const s = buf.toString('latin1');
  if (!s.startsWith('%PDF-') || !s.trimEnd().endsWith('%%EOF')) return false;
  const m = /startxref\n(\d+)\n%%EOF\s*$/.exec(s);
  if (!m) return false;
  const xrefAt = Number(m[1]);
  if (s.slice(xrefAt, xrefAt + 4) !== 'xref') return false;
  const entries = [...s.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((e) => Number(e[1]));
  return entries.length > 0 && entries.every((off, i) => s.slice(off).startsWith(`${i + 1} 0 obj`));
}
