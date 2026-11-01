/**
 * Đề bài dạng markdown nhẹ: đoạn văn (xuống dòng giữ nguyên), `**đậm**`, bảng `| a | b |` (graphic Part 3/4 "Look at the
 * graphic", lịch/bảng giá…). Không HTML thô – chỉ trả cấu trúc để React dựng phần tử (an toàn XSS).
 */

export type InlineSegment = { text: string; bold: boolean };

export type StemBlock = { kind: 'paragraph'; segments: InlineSegment[] } | { kind: 'table'; header: InlineSegment[][]; rows: InlineSegment[][][]; align: ('left' | 'center' | 'right')[] };

export function parseInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line: string) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Có cần định dạng (bảng/đậm) không – không có thì hiển thị như văn bản thường (giữ nguyên bố cục Reading) */
export function hasStemMarkup(stem: string): boolean {
  return /\*\*.+?\*\*/.test(stem) || stem.split('\n').some((l) => isTableLine(l));
}

export function parseStem(stem: string): StemBlock[] {
  const lines = stem.replace(/\r\n?/g, '\n').split('\n');
  const blocks: StemBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    const text = para.join('\n').trim();
    if (text) blocks.push({ kind: 'paragraph', segments: parseInline(text) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Bảng: dòng tiêu đề + dòng phân cách `| --- |` + các dòng dữ liệu
    if (isTableLine(line) && i + 1 < lines.length && isSeparator(lines[i + 1]!)) {
      flush();
      const header = cells(line).map(parseInline);
      const align = cells(lines[i + 1]!).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
      const rows: InlineSegment[][][] = [];
      i += 2;
      for (; i < lines.length && isTableLine(lines[i]!); i++) rows.push(cells(lines[i]!).map(parseInline));
      i--;
      blocks.push({ kind: 'table', header, rows, align });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
