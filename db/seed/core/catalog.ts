import { sql } from 'drizzle-orm';
import type { Db } from '../../src/client.js';
import {
  catalogPrograms,
  catalogQuestionTypes,
  catalogSections,
  catalogSkills,
  catalogSubskills,
  catalogTopics,
} from '../../drizzle/schema/index.js';
import { QUESTION_TYPE_CODES } from '@allingo/schemas';

/** Chương trình, kỹ năng, section, subskill, topic, question_types (nội dung do Allingo tự định nghĩa). */

const PROGRAMS = [
  {
    code: 'toeic',
    name: { vi: 'TOEIC', en: 'TOEIC' },
    scoreScale: { type: 'toeic', lr: { min: 10, max: 990 }, sw: { min: 0, max: 200 } },
    languages: ['en'],
    sortOrder: 1,
  },
  {
    code: 'ielts',
    name: { vi: 'IELTS', en: 'IELTS' },
    scoreScale: { type: 'band', min: 0, max: 9, step: 0.5 },
    languages: ['en'],
    sortOrder: 2,
  },
  {
    code: 'jlpt',
    name: { vi: 'JLPT', en: 'JLPT' },
    scoreScale: { type: 'points', max: 180, levels: ['N5', 'N4', 'N3', 'N2', 'N1'] },
    languages: ['ja'],
    sortOrder: 3,
  },
  {
    code: 'hsk',
    name: { vi: 'HSK', en: 'HSK' },
    scoreScale: { type: 'hsk3', levels: ['1', '2', '3', '4', '5', '6', '7-9'] },
    languages: ['zh'],
    sortOrder: 4,
  },
] as const;

type SkillSeed = { program: string; code: string; name: { vi: string; en: string }; sortOrder: number };
const SKILLS: SkillSeed[] = [
  { program: 'toeic', code: 'listening', name: { vi: 'Nghe', en: 'Listening' }, sortOrder: 1 },
  { program: 'toeic', code: 'reading', name: { vi: 'Đọc', en: 'Reading' }, sortOrder: 2 },
  { program: 'toeic', code: 'speaking', name: { vi: 'Nói', en: 'Speaking' }, sortOrder: 3 },
  { program: 'toeic', code: 'writing', name: { vi: 'Viết', en: 'Writing' }, sortOrder: 4 },
  { program: 'ielts', code: 'listening', name: { vi: 'Nghe', en: 'Listening' }, sortOrder: 1 },
  { program: 'ielts', code: 'reading', name: { vi: 'Đọc', en: 'Reading' }, sortOrder: 2 },
  { program: 'ielts', code: 'writing', name: { vi: 'Viết', en: 'Writing' }, sortOrder: 3 },
  { program: 'ielts', code: 'speaking', name: { vi: 'Nói', en: 'Speaking' }, sortOrder: 4 },
  {
    program: 'jlpt',
    code: 'language_knowledge',
    name: { vi: 'Kiến thức ngôn ngữ (Từ vựng – Ngữ pháp)', en: 'Language Knowledge' },
    sortOrder: 1,
  },
  { program: 'jlpt', code: 'reading', name: { vi: 'Đọc hiểu', en: 'Reading' }, sortOrder: 2 },
  { program: 'jlpt', code: 'listening', name: { vi: 'Nghe hiểu', en: 'Listening' }, sortOrder: 3 },
  { program: 'hsk', code: 'listening', name: { vi: 'Nghe', en: 'Listening' }, sortOrder: 1 },
  { program: 'hsk', code: 'reading', name: { vi: 'Đọc', en: 'Reading' }, sortOrder: 2 },
  { program: 'hsk', code: 'writing', name: { vi: 'Viết', en: 'Writing' }, sortOrder: 3 },
];

type SectionSeed = {
  program: string;
  skill: string;
  code: string;
  name: { vi: string; en: string };
  level?: string | null;
  sortOrder: number;
  durationSec?: number | null;
  questionCount?: number | null;
  rules?: Record<string, unknown>;
};

const toeicSections: SectionSeed[] = [
  {
    program: 'toeic',
    skill: 'listening',
    code: 'part1',
    name: { vi: 'Part 1 – Mô tả tranh', en: 'Part 1 – Photographs' },
    sortOrder: 1,
    durationSec: 180,
    questionCount: 6,
    rules: { audio_once: true, has_image: true, pause_ms: 5000 },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'part2',
    name: { vi: 'Part 2 – Hỏi đáp', en: 'Part 2 – Question-Response' },
    sortOrder: 2,
    durationSec: 540,
    questionCount: 25,
    rules: { audio_once: true, pause_ms: 5000 },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'part3',
    name: { vi: 'Part 3 – Hội thoại', en: 'Part 3 – Conversations' },
    sortOrder: 3,
    durationSec: 1020,
    questionCount: 39,
    rules: { audio_once: true, group_size: 3, pause_ms: 8000 },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'part4',
    name: { vi: 'Part 4 – Bài nói ngắn', en: 'Part 4 – Talks' },
    sortOrder: 4,
    durationSec: 960,
    questionCount: 30,
    rules: { audio_once: true, group_size: 3, pause_ms: 8000 },
  },
  {
    program: 'toeic',
    skill: 'reading',
    code: 'part5',
    name: { vi: 'Part 5 – Hoàn thành câu', en: 'Part 5 – Incomplete Sentences' },
    sortOrder: 5,
    durationSec: 600,
    questionCount: 30,
    rules: { lock_on_timeout: false },
  },
  {
    program: 'toeic',
    skill: 'reading',
    code: 'part6',
    name: { vi: 'Part 6 – Hoàn thành đoạn văn', en: 'Part 6 – Text Completion' },
    sortOrder: 6,
    durationSec: 480,
    questionCount: 16,
    rules: { group_size: 4 },
  },
  {
    program: 'toeic',
    skill: 'reading',
    code: 'part7',
    name: { vi: 'Part 7 – Đọc hiểu', en: 'Part 7 – Reading Comprehension' },
    sortOrder: 7,
    durationSec: 3420,
    questionCount: 54,
    rules: { group_size: [2, 3, 4, 5] },
  },
  {
    program: 'toeic',
    skill: 'speaking',
    code: 'speaking_q1_2',
    name: { vi: 'Speaking Q1–2 – Đọc to', en: 'Speaking Q1–2 – Read a text aloud' },
    sortOrder: 8,
    durationSec: 240,
    questionCount: 2,
    rules: { prep_sec: 45, response_sec: 45 },
  },
  {
    program: 'toeic',
    skill: 'speaking',
    code: 'speaking_q3_4',
    name: { vi: 'Speaking Q3–4 – Mô tả tranh', en: 'Speaking Q3–4 – Describe a picture' },
    sortOrder: 9,
    durationSec: 240,
    questionCount: 2,
    rules: { prep_sec: 45, response_sec: 30 },
  },
  {
    program: 'toeic',
    skill: 'speaking',
    code: 'speaking_q5_7',
    name: { vi: 'Speaking Q5–7 – Trả lời câu hỏi', en: 'Speaking Q5–7 – Respond to questions' },
    sortOrder: 10,
    durationSec: 180,
    questionCount: 3,
    rules: { prep_sec: 3, response_sec: 15 },
  },
  {
    program: 'toeic',
    skill: 'speaking',
    code: 'speaking_q8_10',
    name: { vi: 'Speaking Q8–10 – Trả lời dựa trên thông tin', en: 'Speaking Q8–10 – Respond using information' },
    sortOrder: 11,
    durationSec: 240,
    questionCount: 3,
    rules: { prep_sec: 45, response_sec: 15 },
  },
  {
    program: 'toeic',
    skill: 'speaking',
    code: 'speaking_q11',
    name: { vi: 'Speaking Q11 – Trình bày ý kiến', en: 'Speaking Q11 – Express an opinion' },
    sortOrder: 12,
    durationSec: 105,
    questionCount: 1,
    rules: { prep_sec: 45, response_sec: 60 },
  },
  {
    program: 'toeic',
    skill: 'writing',
    code: 'writing_q1_5',
    name: { vi: 'Writing Q1–5 – Viết câu theo tranh', en: 'Writing Q1–5 – Write a sentence based on a picture' },
    sortOrder: 13,
    durationSec: 480,
    questionCount: 5,
  },
  {
    program: 'toeic',
    skill: 'writing',
    code: 'writing_q6_7',
    name: { vi: 'Writing Q6–7 – Trả lời email', en: 'Writing Q6–7 – Respond to a written request' },
    sortOrder: 14,
    durationSec: 1200,
    questionCount: 2,
  },
  {
    program: 'toeic',
    skill: 'writing',
    code: 'writing_q8',
    name: { vi: 'Writing Q8 – Viết luận', en: 'Writing Q8 – Write an opinion essay' },
    sortOrder: 15,
    durationSec: 1800,
    questionCount: 1,
  },
];

const ieltsSections: SectionSeed[] = [
  {
    program: 'ielts',
    skill: 'listening',
    code: 'listening_p1',
    name: { vi: 'Listening Part 1', en: 'Listening Part 1' },
    sortOrder: 1,
    durationSec: 450,
    questionCount: 10,
    rules: { audio_once: true },
  },
  {
    program: 'ielts',
    skill: 'listening',
    code: 'listening_p2',
    name: { vi: 'Listening Part 2', en: 'Listening Part 2' },
    sortOrder: 2,
    durationSec: 450,
    questionCount: 10,
    rules: { audio_once: true },
  },
  {
    program: 'ielts',
    skill: 'listening',
    code: 'listening_p3',
    name: { vi: 'Listening Part 3', en: 'Listening Part 3' },
    sortOrder: 3,
    durationSec: 450,
    questionCount: 10,
    rules: { audio_once: true },
  },
  {
    program: 'ielts',
    skill: 'listening',
    code: 'listening_p4',
    name: { vi: 'Listening Part 4', en: 'Listening Part 4' },
    sortOrder: 4,
    durationSec: 450,
    questionCount: 10,
    rules: { audio_once: true },
  },
  {
    program: 'ielts',
    skill: 'reading',
    code: 'reading_p1',
    name: { vi: 'Reading Passage 1', en: 'Reading Passage 1' },
    sortOrder: 5,
    durationSec: 1200,
    questionCount: 13,
  },
  {
    program: 'ielts',
    skill: 'reading',
    code: 'reading_p2',
    name: { vi: 'Reading Passage 2', en: 'Reading Passage 2' },
    sortOrder: 6,
    durationSec: 1200,
    questionCount: 13,
  },
  {
    program: 'ielts',
    skill: 'reading',
    code: 'reading_p3',
    name: { vi: 'Reading Passage 3', en: 'Reading Passage 3' },
    sortOrder: 7,
    durationSec: 1200,
    questionCount: 14,
  },
  {
    program: 'ielts',
    skill: 'writing',
    code: 'writing_task1',
    name: { vi: 'Writing Task 1', en: 'Writing Task 1' },
    sortOrder: 8,
    durationSec: 1200,
    questionCount: 1,
    rules: { min_words: 150 },
  },
  {
    program: 'ielts',
    skill: 'writing',
    code: 'writing_task2',
    name: { vi: 'Writing Task 2', en: 'Writing Task 2' },
    sortOrder: 9,
    durationSec: 2400,
    questionCount: 1,
    rules: { min_words: 250 },
  },
  {
    program: 'ielts',
    skill: 'speaking',
    code: 'speaking_part1',
    name: { vi: 'Speaking Part 1', en: 'Speaking Part 1' },
    sortOrder: 10,
    durationSec: 300,
    questionCount: 4,
  },
  {
    program: 'ielts',
    skill: 'speaking',
    code: 'speaking_part2',
    name: { vi: 'Speaking Part 2', en: 'Speaking Part 2' },
    sortOrder: 11,
    durationSec: 240,
    questionCount: 1,
    rules: { prep_sec: 60, response_sec: 120 },
  },
  {
    program: 'ielts',
    skill: 'speaking',
    code: 'speaking_part3',
    name: { vi: 'Speaking Part 3', en: 'Speaking Part 3' },
    sortOrder: 12,
    durationSec: 300,
    questionCount: 4,
  },
];

const jlptLevels = ['N5', 'N4', 'N3', 'N2', 'N1'];
const jlptSections: SectionSeed[] = jlptLevels.flatMap((level, i) => [
  {
    program: 'jlpt',
    skill: 'language_knowledge',
    code: 'vocab',
    name: { vi: 'Từ vựng', en: 'Vocabulary' },
    level,
    sortOrder: i * 10 + 1,
  },
  {
    program: 'jlpt',
    skill: 'language_knowledge',
    code: 'grammar',
    name: { vi: 'Ngữ pháp', en: 'Grammar' },
    level,
    sortOrder: i * 10 + 2,
  },
  {
    program: 'jlpt',
    skill: 'reading',
    code: 'reading',
    name: { vi: 'Đọc hiểu', en: 'Reading' },
    level,
    sortOrder: i * 10 + 3,
  },
  {
    program: 'jlpt',
    skill: 'listening',
    code: 'listening',
    name: { vi: 'Nghe hiểu', en: 'Listening' },
    level,
    sortOrder: i * 10 + 4,
    rules: { audio_once: true },
  },
]);

const hskLevels = ['1', '2', '3', '4', '5', '6', '7-9'];
const hskSections: SectionSeed[] = hskLevels.flatMap((level, i) => [
  {
    program: 'hsk',
    skill: 'listening',
    code: 'listening',
    name: { vi: 'Nghe', en: 'Listening' },
    level,
    sortOrder: i * 10 + 1,
    rules: { audio_once: true },
  },
  {
    program: 'hsk',
    skill: 'reading',
    code: 'reading',
    name: { vi: 'Đọc', en: 'Reading' },
    level,
    sortOrder: i * 10 + 2,
  },
  ...(Number.parseInt(level, 10) >= 3 || level === '7-9'
    ? [
        {
          program: 'hsk',
          skill: 'writing',
          code: 'writing',
          name: { vi: 'Viết', en: 'Writing' },
          level,
          sortOrder: i * 10 + 3,
        } satisfies SectionSeed,
      ]
    : []),
]);

const SECTIONS = [...toeicSections, ...ieltsSections, ...jlptSections, ...hskSections];

const SUBSKILLS: Array<{ program: string; skill: string; code: string; name: { vi: string; en: string } }> = [
  { program: 'toeic', skill: 'reading', code: 'verb_tense', name: { vi: 'Thì động từ', en: 'Verb tenses' } },
  { program: 'toeic', skill: 'reading', code: 'word_form', name: { vi: 'Dạng từ', en: 'Word forms' } },
  { program: 'toeic', skill: 'reading', code: 'preposition', name: { vi: 'Giới từ', en: 'Prepositions' } },
  { program: 'toeic', skill: 'reading', code: 'conjunction', name: { vi: 'Liên từ', en: 'Conjunctions' } },
  { program: 'toeic', skill: 'reading', code: 'pronoun', name: { vi: 'Đại từ', en: 'Pronouns' } },
  {
    program: 'toeic',
    skill: 'reading',
    code: 'vocabulary_context',
    name: { vi: 'Từ vựng theo ngữ cảnh', en: 'Vocabulary in context' },
  },
  {
    program: 'toeic',
    skill: 'reading',
    code: 'relative_clause',
    name: { vi: 'Mệnh đề quan hệ', en: 'Relative clauses' },
  },
  { program: 'toeic', skill: 'reading', code: 'detail', name: { vi: 'Tìm chi tiết', en: 'Detail' } },
  { program: 'toeic', skill: 'reading', code: 'inference', name: { vi: 'Suy luận', en: 'Inference' } },
  {
    program: 'toeic',
    skill: 'reading',
    code: 'paraphrase_recognition',
    name: { vi: 'Nhận diện paraphrase', en: 'Paraphrase recognition' },
  },
  { program: 'toeic', skill: 'listening', code: 'wh_question', name: { vi: 'Câu hỏi Wh-', en: 'Wh- questions' } },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'yes_no_question',
    name: { vi: 'Câu hỏi Yes/No', en: 'Yes/No questions' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'indirect_response',
    name: { vi: 'Trả lời gián tiếp', en: 'Indirect responses' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'similar_sound',
    name: { vi: 'Bẫy âm giống nhau', en: 'Similar-sound traps' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'listening_detail',
    name: { vi: 'Nghe chi tiết', en: 'Listening for detail' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'listening_gist',
    name: { vi: 'Nghe ý chính', en: 'Listening for gist' },
  },
  // Sprint 4 – đủ dạng câu Listening Part 1–4
  {
    program: 'toeic',
    skill: 'listening',
    code: 'photo_description',
    name: { vi: 'Mô tả tranh', en: 'Photo description' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'tag_question',
    name: { vi: 'Câu hỏi đuôi', en: 'Tag questions' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'choice_question',
    name: { vi: 'Câu hỏi lựa chọn', en: 'Choice questions' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'request_suggestion',
    name: { vi: 'Yêu cầu, đề nghị, gợi ý', en: 'Requests, offers and suggestions' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'statement_response',
    name: { vi: 'Phản hồi câu trần thuật', en: 'Responses to statements' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'listening_inference',
    name: { vi: 'Suy luận khi nghe', en: 'Inference (listening)' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'next_action',
    name: { vi: 'Hành động tiếp theo', en: 'Next action' },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'speaker_intent',
    name: { vi: 'Hàm ý người nói', en: "Speaker's intent" },
  },
  {
    program: 'toeic',
    skill: 'listening',
    code: 'graphic_question',
    name: { vi: 'Câu hỏi kết hợp bảng/biểu đồ', en: 'Graphic questions' },
  },
];

const TOPICS: Array<{ program: string | null; code: string; name: { vi: string; en: string } }> = [
  { program: null, code: 'business', name: { vi: 'Kinh doanh', en: 'Business' } },
  { program: null, code: 'office', name: { vi: 'Văn phòng', en: 'Office' } },
  { program: null, code: 'travel', name: { vi: 'Du lịch', en: 'Travel' } },
  { program: null, code: 'shopping', name: { vi: 'Mua sắm', en: 'Shopping' } },
  { program: null, code: 'logistics', name: { vi: 'Vận chuyển', en: 'Logistics' } },
  { program: null, code: 'hr', name: { vi: 'Nhân sự', en: 'Human resources' } },
  { program: null, code: 'finance', name: { vi: 'Tài chính', en: 'Finance' } },
  { program: null, code: 'technology', name: { vi: 'Công nghệ', en: 'Technology' } },
  { program: null, code: 'health', name: { vi: 'Sức khoẻ', en: 'Health' } },
  { program: null, code: 'education', name: { vi: 'Giáo dục', en: 'Education' } },
];

const QUESTION_TYPE_NAMES: Record<string, { vi: string; en: string }> = {
  mcq_single: { vi: 'Trắc nghiệm 1 đáp án', en: 'Multiple choice (single)' },
  mcq_multi: { vi: 'Trắc nghiệm nhiều đáp án', en: 'Multiple choice (multi)' },
  fill_blank: { vi: 'Điền từ/số', en: 'Fill in the blank' },
  matching: { vi: 'Nối / Matching headings', en: 'Matching' },
  drag_drop: { vi: 'Kéo thả', en: 'Drag & drop' },
  map_label: { vi: 'Gán nhãn bản đồ/biểu đồ', en: 'Map/diagram labelling' },
  tfng: { vi: 'True/False/Not Given', en: 'True/False/Not Given' },
  ordering: { vi: 'Sắp xếp', en: 'Ordering' },
  dictation: { vi: 'Nghe chép chính tả', en: 'Dictation' },
  essay: { vi: 'Viết tự luận', en: 'Essay' },
  speaking: { vi: 'Nói ghi âm', en: 'Speaking (recorded)' },
  handwriting: { vi: 'Viết tay chữ Hán/Kanji', en: 'Handwriting (Hanzi/Kanji)' },
};
const NOT_AUTO = new Set(['essay', 'speaking', 'handwriting']);

export async function seedCatalog(db: Db): Promise<void> {
  await db
    .insert(catalogPrograms)
    .values(
      PROGRAMS.map((p) => ({
        code: p.code,
        name: p.name,
        scoreScale: p.scoreScale,
        languages: [...p.languages],
        isActive: true,
        sortOrder: p.sortOrder,
      })),
    )
    .onConflictDoUpdate({
      target: catalogPrograms.code,
      set: {
        name: sql`excluded.name`,
        scoreScale: sql`excluded.score_scale`,
        languages: sql`excluded.languages`,
        sortOrder: sql`excluded.sort_order`,
      },
    });

  await db
    .insert(catalogQuestionTypes)
    .values(
      QUESTION_TYPE_CODES.map((code) => ({
        code,
        name: QUESTION_TYPE_NAMES[code]!,
        contentSchema: {
          $ref: `schemas/question/${code}.json`,
          package: '@allingo/schemas',
          export: 'questionContentSchemasByType',
        },
        autoGradable: !NOT_AUTO.has(code),
      })),
    )
    .onConflictDoUpdate({
      target: catalogQuestionTypes.code,
      set: {
        name: sql`excluded.name`,
        contentSchema: sql`excluded.content_schema`,
        autoGradable: sql`excluded.auto_gradable`,
      },
    });

  const skillRows = await db
    .insert(catalogSkills)
    .values(SKILLS.map((s) => ({ programCode: s.program, code: s.code, name: s.name, sortOrder: s.sortOrder })))
    .onConflictDoUpdate({
      target: [catalogSkills.programCode, catalogSkills.code],
      set: { name: sql`excluded.name`, sortOrder: sql`excluded.sort_order` },
    })
    .returning({ id: catalogSkills.id, programCode: catalogSkills.programCode, code: catalogSkills.code });
  const skillId = new Map(skillRows.map((r) => [`${r.programCode}:${r.code}`, r.id]));

  await db
    .insert(catalogSections)
    .values(
      SECTIONS.map((s) => ({
        programCode: s.program,
        skillId: skillId.get(`${s.program}:${s.skill}`)!,
        code: s.code,
        name: s.name,
        level: s.level ?? null,
        sortOrder: s.sortOrder,
        durationSec: s.durationSec ?? null,
        questionCount: s.questionCount ?? null,
        rules: s.rules ?? {},
      })),
    )
    .onConflictDoUpdate({
      target: [catalogSections.programCode, catalogSections.code, catalogSections.level],
      set: {
        name: sql`excluded.name`,
        sortOrder: sql`excluded.sort_order`,
        durationSec: sql`excluded.duration_sec`,
        questionCount: sql`excluded.question_count`,
        rules: sql`excluded.rules`,
        skillId: sql`excluded.skill_id`,
      },
    });

  await db
    .insert(catalogSubskills)
    .values(
      SUBSKILLS.map((s) => ({
        programCode: s.program,
        skillId: skillId.get(`${s.program}:${s.skill}`)!,
        code: s.code,
        name: s.name,
      })),
    )
    .onConflictDoUpdate({
      target: [catalogSubskills.programCode, catalogSubskills.code],
      set: { name: sql`excluded.name`, skillId: sql`excluded.skill_id` },
    });

  await db
    .insert(catalogTopics)
    .values(TOPICS.map((t) => ({ programCode: t.program, code: t.code, name: t.name })))
    .onConflictDoNothing();
}
