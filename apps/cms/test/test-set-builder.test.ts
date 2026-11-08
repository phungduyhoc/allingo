import { describe, expect, it } from 'vitest';
import { mergedBody, toSyncPassage } from '../src/lib/passages';
import { addQuestions, BUILDER_BLUEPRINTS, blueprintErrors, blueprintReport, fromCollection, moveSection, moveUnit, pruneSections, removeQuestion, toCollectionData, unitsOf, type BuilderState } from '../src/lib/test-set-builder';
import { validateTestSetStructure } from '../src/lib/validate';

/** A26 – trình dựng bộ đề kéo thả (hàm thuần) + B5 đồng bộ passage nhiều văn bản */
const base = (): BuilderState => ({
  sections: [
    { sectionCode: 'part5', durationSec: null },
    { sectionCode: 'part7', durationSec: null },
  ],
  items: [
    { question: 'q1', sectionCode: 'part5', groupKey: null, points: 1 },
    { question: 'q2', sectionCode: 'part5', groupKey: null, points: 1 },
    { question: 'p1a', sectionCode: 'part7', groupKey: 'P1', points: 1 },
    { question: 'p1b', sectionCode: 'part7', groupKey: 'P1', points: 1 },
    { question: 'q3', sectionCode: 'part7', groupKey: null, points: 1 },
  ],
});
const order = (s: BuilderState) => s.items.map((i) => i.question);

describe('trình dựng bộ đề (A26)', () => {
  it('khối = câu đơn hoặc trọn nhóm passage; kéo khối nhóm giữ nhóm liền nhau', () => {
    const s = base();
    expect(unitsOf(s, 'part7').map((u) => u.items.map((i) => i.question))).toEqual([['p1a', 'p1b'], ['q3']]);
    const moved = moveUnit(s, 'part7', 0, 1);
    expect(order(moved)).toEqual(['q1', 'q2', 'q3', 'p1a', 'p1b']);
    expect(order(moveUnit(s, 'part5', 1, 0))).toEqual(['q2', 'q1', 'p1a', 'p1b', 'q3']);
    // Vượt biên → không đổi
    expect(order(moveUnit(s, 'part5', 0, -1))).toEqual(['q1', 'q2', 'p1a', 'p1b', 'q3']);
  });
  it('đổi thứ tự Part: câu đi theo Part, thứ tự trong Part giữ nguyên', () => {
    const s = moveSection(base(), 1, 0);
    expect(s.sections.map((x) => x.sectionCode)).toEqual(['part7', 'part5']);
    expect(order(s)).toEqual(['p1a', 'p1b', 'q3', 'q1', 'q2']);
  });
  it('thêm câu từ ngân hàng: bỏ câu đã có, câu cùng passage đặt ngay sau nhóm, Part mới theo thứ tự TOEIC', () => {
    const r = addQuestions(base(), [
      { id: 'q1', title: 'dup', sectionCode: 'part5', status: 'published', difficulty: null, passageId: null },
      { id: 'p1c', title: 'c', sectionCode: 'part7', status: 'published', difficulty: null, passageId: 'P1' },
      { id: 'q6', title: 'p6', sectionCode: 'part6', status: 'published', difficulty: 'B1', passageId: 'P6' },
    ]);
    expect(r.added).toBe(2);
    expect(r.state.sections.map((x) => x.sectionCode)).toEqual(['part5', 'part6', 'part7']);
    expect(order(r.state)).toEqual(['q1', 'q2', 'q6', 'p1a', 'p1b', 'p1c', 'q3']);
  });
  it('bớt câu + bỏ Part rỗng; sortOrder 1…n duy nhất → hợp lệ cấu trúc', () => {
    const s = pruneSections(removeQuestion(removeQuestion(base(), 'q1'), 'q2'));
    expect(s.sections.map((x) => x.sectionCode)).toEqual(['part7']);
    const data = toCollectionData(s);
    expect(data.items.map((i) => i.sortOrder)).toEqual([1, 2, 3]);
    expect(validateTestSetStructure({ program: 'toeic', kind: 'mini', sections: data.sections, items: data.items })).toEqual([]);
  });
  it('collection ↔ trạng thái (sắp theo Part rồi sortOrder, relationship đã populate)', () => {
    const st = fromCollection({
      sections: [{ sectionCode: 'part5' }, { sectionCode: 'part7' }],
      items: [
        { question: { id: 'b' }, sectionCode: 'part7', sortOrder: 1, groupKey: 'G' },
        { question: 'a2', sectionCode: 'part5', sortOrder: 9 },
        { question: 'a1', sectionCode: 'part5', sortOrder: 2 },
        { question: null, sectionCode: 'part5', sortOrder: 3 },
      ],
    });
    expect(order(st)).toEqual(['a1', 'a2', 'b']);
    expect(st.items[2]).toMatchObject({ groupKey: 'G', points: 1 });
  });
  it('blueprint: đủ/thiếu/thừa mỗi Part + Part ngoài blueprint; mẫu TOEIC full 200 và mini 60', () => {
    const rep = blueprintReport([{ sectionCode: 'part5', count: 3 }, { sectionCode: 'part7', count: 3 }], base());
    expect(rep.ok).toBe(false);
    expect(blueprintErrors(rep)).toEqual(['part5: cần 3 câu, hiện có 2 (thiếu 1).']);
    expect(blueprintReport([{ sectionCode: 'part5', count: 2 }, { sectionCode: 'part7', count: 3 }], base()).ok).toBe(true);
    expect(blueprintErrors(blueprintReport([{ sectionCode: 'part5', count: 2 }], base()))).toEqual(['part7: không có trong blueprint.']);
    expect(BUILDER_BLUEPRINTS.toeic_full_200!.sections.reduce((n, s) => n + s.count, 0)).toBe(200);
    expect(BUILDER_BLUEPRINTS.toeic_mini_60!.sections.reduce((n, s) => n + s.count, 0)).toBe(60);
  });
});

describe('passage nhiều văn bản (B5)', () => {
  it('toSyncPassage: id CMS = id catalog, bỏ văn bản rỗng, trạng thái/loại mặc định an toàn', () => {
    expect(toSyncPassage({ id: 'uuid-1', title: 'P', program: 'toeic', kind: 'reading_passage', status: 'ready', parts: [{ title: ' E-mail ', body: ' Hi ' }, { title: '', body: '  ' }, { title: null, body: 'Two' }] })).toEqual({
      passage_id: 'uuid-1',
      program: 'toeic',
      kind: 'reading_passage',
      title: 'P',
      body: null,
      difficulty: null,
      status: 'ready',
      parts: [
        { title: 'E-mail', body: 'Hi' },
        { title: null, body: 'Two' },
      ],
    });
    expect(toSyncPassage({ id: 2, kind: 'weird', status: 'other' })).toMatchObject({ passage_id: '2', program: 'toeic', kind: 'reading_passage', status: 'draft', parts: [] });
  });
  it('mergedBody: bản gộp [Tiêu đề] giống API/seed', () => {
    expect(mergedBody([{ title: 'Notice', body: 'Open 9–5.' }, { title: '', body: 'Mail' }])).toBe('[Notice]\nOpen 9–5.\n\n[Text 2]\nMail');
  });
});
