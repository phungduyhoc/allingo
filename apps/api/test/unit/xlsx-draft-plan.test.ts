import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { buildDraftPlan, groupSizesOf } from '../../src/modules/catalog/content-draft-test.service.js';
import { dedupKeyText } from '../../src/modules/catalog/content-dedup.service.js';
import { mergePartsBody } from '../../src/modules/catalog/content-passage.service.js';
import { colName, crc32, readXlsx, unzip, writeXlsx, xmlUnescape, zip, XlsxError } from '../../src/modules/catalog/import/xlsx.js';

/** B2 – đọc/ghi .xlsx tối giản (không thư viện), kế hoạch AI soạn đề theo blueprint, văn bản so trùng */
describe('xlsx codec', () => {
  it('ghi → đọc lại (chuỗi inline, số, ký tự đặc biệt, xuống dòng, ô trống giữa hàng)', () => {
    const buf = writeXlsx([
      { name: 'Cau_hoi', columns: [{ width: 10 }, { width: 10 }, { width: 10 }], freezeRows: 1, rows: [{ cells: ['a', 'b', 'c'], style: 'header' }, { cells: ['x & <y>', 42, 'dòng 1\ndòng 2'] }, { cells: ['', null, 'z'] }], validations: [{ col: 0, list: ['toeic', 'ielts'], prompt: 'chú thích', promptTitle: 'a', lastRow: 10 }] },
      { name: 'Huong_dan', columns: [{ width: 20 }], rows: [{ cells: ['guide'] }] },
    ]);
    const r = readXlsx(buf);
    expect(r.sheet).toBe('Cau_hoi');
    expect(r.rows.map((x) => x.cells)).toEqual([
      ['a', 'b', 'c'],
      ['x & <y>', '42', 'dòng 1\ndòng 2'],
      ['', '', 'z'],
    ]);
    expect(r.rows.map((x) => x.rowNumber)).toEqual([1, 2, 3]);
    expect(readXlsx(buf, { sheetName: 'Huong_dan' }).rows[0]!.cells).toEqual(['guide']);
    // Tất định: cùng nội dung → cùng byte (fingerprint ổn định)
    expect(writeXlsx([{ name: 'S', columns: [], rows: [{ cells: ['q'] }] }]).equals(writeXlsx([{ name: 'S', columns: [], rows: [{ cells: ['q'] }] }]))).toBe(true);
  });

  it('đọc tệp kiểu Excel: shared strings (rich text, _x000D_), số, boolean, công thức, tiền tố namespace, ô thiếu r', () => {
    const sst = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3"><si><t>import_key</t></si><si><r><rPr><b/></rPr><t>Rich </t></r><r><t xml:space="preserve">text</t></r><rPh><t>PHONETIC</t></rPh></si><si><t>a_x000D_b &amp; c</t></si></sst>';
    const sheet =
      '<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
      '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>1</x:v></x:c></x:row>' +
      '<x:row r="3"><x:c r="A3" t="s"><x:v>2</x:v></x:c><x:c r="B3"><x:v>3.5</x:v></x:c><x:c r="C3" t="b"><x:v>1</x:v></x:c><x:c r="D3" t="str"><x:f>A1</x:f><x:v>calc</x:v></x:c><x:c t="inlineStr"><x:is><x:t>implicit</x:t></x:is></x:c></x:row>' +
      '</x:sheetData></x:worksheet>';
    const files = [
      { name: 'xl/workbook.xml', data: Buffer.from('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId7"/></sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId7" Type="worksheet" Target="/xl/worksheets/data.xml"/></Relationships>') },
      { name: 'xl/sharedStrings.xml', data: Buffer.from(sst) },
      { name: 'xl/worksheets/data.xml', data: Buffer.from(sheet) },
    ];
    const r = readXlsx(zip(files));
    expect(r.sheet).toBe('Data');
    expect(r.rows).toEqual([
      { rowNumber: 1, cells: ['import_key', '', 'Rich text'] },
      { rowNumber: 3, cells: ['a\rb & c', '3.5', 'TRUE', 'calc', 'implicit'] },
    ]);
  });

  it('ZIP: phương thức stored + deflate, CRC32 chuẩn, lỗi rõ ràng khi không phải xlsx', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const z = zip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    expect(unzip(z).get('a.txt')!.toString()).toBe('hello');
    expect(deflateRawSync(Buffer.from('x')).length).toBeGreaterThan(0);
    expect(() => readXlsx(Buffer.from('not a zip at all, definitely not'))).toThrow(XlsxError);
    expect(() => readXlsx(z)).toThrow(/workbook/);
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(xmlUnescape('&#x41;&#66;&lt;')).toBe('AB<');
  });
});

describe('AI soạn đề – kế hoạch theo blueprint', () => {
  const sections = [
    { id: 's3', code: 'part3', skill: 'listening', sort_order: 3, question_count: 39, rules: { audio_once: true, group_size: 3 } },
    { id: 's5', code: 'part5', skill: 'reading', sort_order: 5, question_count: 30, rules: {} },
    { id: 's6', code: 'part6', skill: 'reading', sort_order: 6, question_count: 16, rules: { group_size: 4 } },
    { id: 's7', code: 'part7', skill: 'reading', sort_order: 7, question_count: 54, rules: { group_size: [2, 3, 4, 5] } },
  ];
  it('Part đơn → lô; Part nhóm → nhóm passage, Part 7 bộ đôi cho nhóm ≥ 5 câu; sắp theo thứ tự Part', () => {
    const { plan, issues } = buildDraftPlan({ program: 'toeic', kind: 'mini', blueprint: { sections: [{ section_code: 'part7', count: 7, multi_passage_texts: 2 }, { section_code: 'part5', count: 4 }, { section_code: 'part3', count: 6 }, { section_code: 'part6', count: 4 }], topics: [] } }, sections);
    expect(issues).toEqual([]);
    expect(plan.map((p) => [p.section_code, p.mode, p.groups, p.text_counts, p.passage_kind])).toEqual([
      ['part3', 'group', [3, 3], [1, 1], 'audio_script'],
      ['part5', 'single', [], [], 'reading_passage'],
      ['part6', 'group', [4], [1], 'reading_passage'],
      ['part7', 'group', [5, 2], [2, 1], 'reading_passage'],
    ]);
  });
  it('lỗi blueprint: Part lạ, vượt số câu chuẩn, không chia được nhóm, part_drill nhiều Part, trùng Part', () => {
    const { issues } = buildDraftPlan({ program: 'toeic', kind: 'part_drill', blueprint: { sections: [{ section_code: 'part9', count: 1 }, { section_code: 'part5', count: 31 }, { section_code: 'part3', count: 4 }, { section_code: 'part6', count: 4 }, { section_code: 'part6', count: 4 }, { section_code: 'part7', count: 2 }], topics: [] } }, sections);
    expect(issues.map((i) => i.message)).toEqual([
      'unknown section part9',
      'part5 allows at most 30 questions',
      '4 questions cannot be split into groups of 3',
      'duplicate section part6',
      'part_drill must have exactly one section',
    ]);
  });
  it('groupSizesOf: số / mảng / blueprint ghi đè / không có', () => {
    expect(groupSizesOf({ group_size: 3 })).toEqual([3]);
    expect(groupSizesOf({ group_size: [2, 3] })).toEqual([2, 3]);
    expect(groupSizesOf({ group_size: 3 }, [4])).toEqual([4]);
    expect(groupSizesOf({})).toBeNull();
  });
});

describe('lọc trùng – văn bản so sánh', () => {
  it('đoạn văn rút gọn + đề bài; đề ngắn (Part 1/2) thêm phương án', () => {
    expect(dedupKeyText({ stem: 'The shipment  ______ on Monday.' })).toBe('The shipment ______ on Monday.');
    expect(dedupKeyText({ stem: 'Question 1: blank [1].' }, 'Long   passage text')).toBe('Long passage text \n Question 1: blank [1].');
    expect(dedupKeyText({ stem: '', options: [{ text: 'Yes' }, { text: 'No' }] })).toBe('Yes No');
    expect(dedupKeyText({ stem: 'x' }, 'p'.repeat(1000)).length).toBeLessThan(420);
  });
  it('mergePartsBody: bản gộp [Tiêu đề] như seed', () => {
    expect(mergePartsBody([{ title: 'E-mail', body: ' Hi ' }, { title: null, body: 'Two' }])).toBe('[E-mail]\nHi\n\n[Text 2]\nTwo');
  });
});
