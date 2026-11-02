import type { ContentInventory, MasteryRow } from '../src/index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Nội dung giống seed demo TOEIC (7 Part, 3 đề full, đề mini, 1 bài ngữ pháp Part 5, 1 bộ từ vựng) */
export const TOEIC_INVENTORY: ContentInventory = {
  sections: [
    { id: uuid(1), code: 'part1', skill: 'listening', name: { vi: 'Part 1', en: 'Part 1' }, question_count: 6, drill_minutes: 6 },
    { id: uuid(2), code: 'part2', skill: 'listening', name: { vi: 'Part 2', en: 'Part 2' }, question_count: 31, drill_minutes: 5 },
    { id: uuid(3), code: 'part3', skill: 'listening', name: { vi: 'Part 3', en: 'Part 3' }, question_count: 39, drill_minutes: 8 },
    { id: uuid(4), code: 'part4', skill: 'listening', name: { vi: 'Part 4', en: 'Part 4' }, question_count: 30, drill_minutes: 8 },
    { id: uuid(5), code: 'part5', skill: 'reading', name: { vi: 'Part 5', en: 'Part 5' }, question_count: 40, drill_minutes: 7 },
    { id: uuid(6), code: 'part6', skill: 'reading', name: { vi: 'Part 6', en: 'Part 6' }, question_count: 16, drill_minutes: 10 },
    { id: uuid(7), code: 'part7', skill: 'reading', name: { vi: 'Part 7', en: 'Part 7' }, question_count: 54, drill_minutes: 12 },
  ],
  testSets: [
    { id: uuid(11), code: 'toeic-lr-full-01', kind: 'full', title: { vi: 'Đề L&R 01', en: 'L&R 01' }, minutes: 120, question_count: 200, sections: ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'] },
    { id: uuid(12), code: 'toeic-reading-full-01', kind: 'full', title: { vi: 'Reading 01', en: 'Reading 01' }, minutes: 75, question_count: 100, sections: ['part5', 'part6', 'part7'] },
    { id: uuid(13), code: 'toeic-listening-full-01', kind: 'full', title: { vi: 'Listening 01', en: 'Listening 01' }, minutes: 45, question_count: 100, sections: ['part1', 'part2', 'part3', 'part4'] },
    { id: uuid(14), code: 'toeic-mini-lr-01', kind: 'mini', title: { vi: 'Mini L&R 01', en: 'Mini L&R 01' }, minutes: 45, question_count: 60, sections: ['part1', 'part5'] },
    { id: uuid(15), code: 'toeic-mini-part5-01', kind: 'mini', title: { vi: 'Mini Part 5', en: 'Mini Part 5' }, minutes: 8, question_count: 10, sections: ['part5'] },
  ],
  lessons: [{ id: uuid(21), section_code: 'part5', kind: 'grammar', title: { vi: 'Thì hiện tại hoàn thành', en: 'Present perfect' }, minutes: 15 }],
  vocabLists: [{ id: uuid(31), title: { vi: '20 từ văn phòng', en: '20 office words' } }],
};

/** Mastery sau chẩn đoán: Reading Part 5 yếu, Listening Part 2 mạnh */
export const MASTERY: MasteryRow[] = [
  { subskill: 'verb_tense', skill: 'reading', sections: ['part5'], mastery: 0.2 },
  { subskill: 'conjunction', skill: 'reading', sections: ['part6'], mastery: 0.45 },
  { subskill: 'word_form', skill: 'reading', sections: ['part5'], mastery: 0.25 },
  { subskill: 'inference', skill: 'reading', sections: ['part7'], mastery: 0.5 },
  { subskill: 'wh_question', skill: 'listening', sections: ['part2'], mastery: 0.9 },
  { subskill: 'listening_detail', skill: 'listening', sections: ['part3', 'part4'], mastery: 0.6 },
  { subskill: 'photo_description', skill: 'listening', sections: ['part1'], mastery: 0.85 },
];
