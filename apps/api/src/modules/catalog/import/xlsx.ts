import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * B2 – đọc/ghi .xlsx tối giản (OOXML SpreadsheetML) bằng node:zlib, KHÔNG thêm thư viện (docs/VERSIONS.md – ưu tiên không thêm phụ thuộc):
 * - ghi: nhiều sheet, chuỗi inline, style (font Arial, header nền #0B3BA7 chữ trắng, dòng ví dụ, viền), độ rộng cột, cố định dòng tiêu đề,
 *   data validation (danh sách chọn + "input message" làm chú thích cột khi chọn ô);
 * - đọc: sheet đầu tiên (hoặc theo tên), shared strings (cả rich text), inline string, số, boolean, công thức có giá trị lưu sẵn.
 * Đủ cho mẫu nhập câu hỏi (≤ 1 MB, ≤ 1.000 dòng); không hỗ trợ ZIP64/mã hoá.
 */

// ------------------------------------------------------------------ ZIP
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Thời điểm cố định (01/01/2026 00:00 DOS) → tệp mẫu tất định (cùng nội dung → cùng sha256) */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export class XlsxError extends Error {
  constructor(readonly reason: 'not_zip' | 'not_xlsx' | 'too_large' | 'corrupt', message: string) {
    super(message);
  }
}

const MAX_ENTRY_BYTES = 30 * 1024 * 1024;

export function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory (cuối tệp, có thể có comment ≤ 64 KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('not_zip', 'not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError('corrupt', 'bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (size > MAX_ENTRY_BYTES) throw new XlsxError('too_large', `entry ${name} too large`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new XlsxError('corrupt', 'bad local header');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
    else throw new XlsxError('corrupt', `unsupported compression ${method}`);
  }
  return out;
}

// ------------------------------------------------------------------ XML
export const xmlEscape = (s: string) =>
  s
    // Ký tự điều khiển không hợp lệ trong XML 1.0 (trừ \t \n \r)
    // eslint-disable-next-line no-control-regex -- lọc ký tự điều khiển cấm trong XML
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function xmlUnescape(s: string): string {
  return s
    .replace(/&(lt|gt|amp|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, (_m, e: string) => {
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'amp') return '&';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

// ------------------------------------------------------------------ ghi
export type CellStyle = 'default' | 'header' | 'example' | 'body' | 'title' | 'note';
const STYLE_INDEX: Record<CellStyle, number> = { default: 0, header: 1, example: 2, body: 3, title: 4, note: 5 };

export interface SheetSpec {
  name: string;
  columns: Array<{ width: number }>;
  rows: Array<{ cells: Array<string | number | null>; style?: CellStyle; height?: number }>;
  /** Cố định n dòng đầu */
  freezeRows?: number;
  /** Danh sách chọn / chú thích (input message) theo cột, áp cho dòng 2…lastRow */
  validations?: Array<{ col: number; list?: string[]; promptTitle?: string; prompt?: string; lastRow: number }>;
  tabColor?: string;
}

export function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Bảng style: Arial 10; header Arial 10 đậm trắng nền #0B3BA7; ví dụ nghiêng nền #EAF0FB; viền mảnh #B4C2E0; tiêu đề Arial 14 đậm #0B3BA7 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="10"/><color rgb="FF1F2937"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF334155"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="14"/><color rgb="FF0B3BA7"/><name val="Arial"/><family val="2"/></font><font><sz val="9"/><color rgb="FF475569"/><name val="Arial"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3BA7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF0FB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB4C2E0"/></left><right style="thin"><color rgb="FFB4C2E0"/></right><top style="thin"><color rgb="FFB4C2E0"/></top><bottom style="thin"><color rgb="FFB4C2E0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(s: SheetSpec): string {
  const cols = s.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
  const rows = s.rows
    .map((r, ri) => {
      const st = STYLE_INDEX[r.style ?? 'default'];
      const cells = r.cells
        .map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          if (v === null || v === undefined || v === '') return st ? `<c r="${ref}" s="${st}"/>` : '';
          if (typeof v === 'number') return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
          return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}"${r.height ? ` ht="${r.height}" customHeight="1"` : ''}>${cells}</row>`;
    })
    .join('');
  const pane = s.freezeRows ? `<pane ySplit="${s.freezeRows}" topLeftCell="A${s.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${s.freezeRows + 1}" sqref="A${s.freezeRows + 1}"/>` : '';
  const dv = (s.validations ?? [])
    .map((v) => {
      const sqref = `${colName(v.col)}2:${colName(v.col)}${v.lastRow}`;
      const list = v.list ? ` type="list"` : '';
      const prompt = v.prompt ? ` showInputMessage="1" promptTitle="${xmlEscape((v.promptTitle ?? '').slice(0, 32))}" prompt="${xmlEscape(v.prompt.slice(0, 255))}"` : '';
      const formula = v.list ? `<formula1>"${xmlEscape(v.list.join(','))}"</formula1>` : '';
      return `<dataValidation${list} allowBlank="1"${v.list ? ' showErrorMessage="1"' : ''}${prompt} sqref="${sqref}">${formula}</dataValidation>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${s.tabColor ? `<sheetPr><tabColor rgb="${s.tabColor}"/></sheetPr>` : ''}<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows}</sheetData>${dv ? `<dataValidations count="${(s.validations ?? []).length}">${dv}</dataValidations>` : ''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
}

export function writeXlsx(sheets: SheetSpec[], meta: { title?: string; creator?: string } = {}): Buffer {
  const enc = (s: string) => Buffer.from(s, 'utf8');
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const files = [
    {
      name: '[Content_Types].xml',
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
      ),
    },
    {
      name: 'docProps/core.xml',
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(meta.title ?? '')}</dc:title><dc:creator>${xmlEscape(meta.creator ?? 'Allingo')}</dc:creator></cp:coreProperties>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/styles.xml', data: enc(STYLES_XML) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s)) })),
  ];
  return zip(files);
}

// ------------------------------------------------------------------ đọc
/** Toàn bộ chữ trong các thẻ <t> (rich text: nhiều <r><t>), bỏ phiên âm <rPh> */
function textOf(xml: string): string {
  const noPh = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let out = '';
  for (const m of noPh.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += xmlUnescape(m[1] ?? '');
  return out;
}

/** Đọc thuộc tính XML theo tên (regex hằng – không dựng RegExp động từ tham số) */
const attr = (attrs: string, name: string): string | undefined => {
  for (const m of attrs.matchAll(/([\w:.-]+)="([^"]*)"/g)) if (m[1] === name) return m[2];
  return undefined;
};

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Sheet → mảng dòng (chuỗi; số giữ dạng chuỗi gốc); `rowNumber` là số dòng thật trong sheet */
export function readXlsx(buf: Buffer, opts: { sheetName?: string } = {}): { sheet: string; rows: Array<{ rowNumber: number; cells: string[] }> } {
  const files = unzip(buf);
  const wb = files.get('xl/workbook.xml')?.toString('utf8');
  if (!wb) throw new XlsxError('not_xlsx', 'xl/workbook.xml missing');
  const sheets = [...wb.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)].map((m) => ({ name: xmlUnescape(attr(m[1]!, 'name') ?? ''), rid: attr(m[1]!, 'r:id') ?? /\b\w+:id="([^"]*)"/.exec(m[1]!)?.[1] ?? '' }));
  if (!sheets.length) throw new XlsxError('not_xlsx', 'workbook has no sheets');
  const chosen = (opts.sheetName ? sheets.find((s) => s.name === opts.sheetName) : undefined) ?? sheets[0]!;
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  let target = 'worksheets/sheet1.xml';
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) if (attr(m[1]!, 'Id') === chosen.rid) target = attr(m[1]!, 'Target') ?? target;
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = files.get(path)?.toString('utf8');
  if (!sheet) throw new XlsxError('not_xlsx', `sheet ${path} missing`);
  const sst = files.get('xl/sharedStrings.xml')?.toString('utf8');
  const shared = sst ? [...sst.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1] ?? '')) : [];
  const rows: Array<{ rowNumber: number; cells: string[] }> = [];
  let implicitRow = 0;
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    implicitRow++;
    const rowNumber = Number(attr(rm[1]!, 'r') ?? implicitRow) || implicitRow;
    implicitRow = rowNumber;
    const cells: string[] = [];
    let implicitCol = -1;
    for (const cm of (rm[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = cm[1] ?? '';
      const body = cm[2] ?? '';
      const ref = attr(a, 'r');
      const ci = ref ? colIndex(ref) : implicitCol + 1;
      implicitCol = ci;
      const t = attr(a, 't');
      const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
      let value = '';
      if (t === 's') value = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') value = textOf(body);
      else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = xmlUnescape(v);
      while (cells.length < ci) cells.push('');
      cells[ci] = value;
    }
    rows.push({ rowNumber, cells });
  }
  return { sheet: chosen.name, rows };
}
