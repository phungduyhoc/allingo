/**
 * Dựng tập eval explain_mcq từ ngân hàng PUBLISHED demo (Reading 01, Listening 01 Part 3/4, Part 5 demo – S5 mục 9).
 * Biến giống hệt production (`ExplainService.variablesOf`): đáp án đúng + giải thích tác giả + trích passage/transcript chỉ ở
 * những trường mà template explain_mcq cho phép; bỏ Part 1/2 (chữ của câu nằm trong audio – A40). Không PII.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { IELTS_FULL_TESTS, QUESTION_FIXTURES_ALL, RL_DEMO_EXTRA, RL_QUESTION_TYPE_CODES, RL_DEMO_LISTENING, RL_DEMO_READING, describeQuestion, questionContentSchema, type AnswerInput, type QuestionContent } from '@allingo/schemas';
import type { DbService } from '../../src/shared/db/db.module.js';
import { ExplainService, type ExplainEvalLine } from '../../src/modules/ai-gateway/index.js';
import type { CatalogQueryService, LoadedQuestion } from '../../src/modules/catalog/index.js';

export const EXPLAIN_EVAL_SOURCES = ['toeic-reading-full-01', 'toeic-listening-full-01', 'toeic-mini-part5-01'] as const;
const EXCLUDED_SECTIONS = new Set(['part1', 'part2']);

export async function buildExplainDataset(dbs: DbService, catalog: CatalogQueryService, opts: { limit?: number } = {}): Promise<ExplainEvalLine[]> {
  const rows = await dbs.db
    .select({ code: schema.catalogTestSets.code, versionId: schema.catalogQuestions.currentVersionId, sort: schema.catalogTestSetItems.sortOrder })
    .from(schema.catalogTestSetItems)
    .innerJoin(schema.catalogTestSets, eq(schema.catalogTestSets.id, schema.catalogTestSetItems.testSetId))
    .innerJoin(schema.catalogQuestions, eq(schema.catalogQuestions.id, schema.catalogTestSetItems.questionId))
    .where(and(inArray(schema.catalogTestSets.code, [...EXPLAIN_EVAL_SOURCES]), eq(schema.catalogQuestions.status, 'published')))
    .orderBy(schema.catalogTestSets.code, schema.catalogTestSetItems.sortOrder);
  const ids = [...new Set(rows.map((r) => r.versionId).filter((x): x is string => !!x))];
  const loaded = await catalog.loadByVersionIds(ids);
  const lines: ExplainEvalLine[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const q = r.versionId ? loaded.get(r.versionId) : undefined;
    if (!q || seen.has(q.question_version_id) || EXCLUDED_SECTIONS.has(q.section_code) || !('options' in q.content)) continue;
    seen.add(q.question_version_id);
    const options = q.content.options;
    const correct = 'answer_key' in q.content && 'correct' in q.content.answer_key ? String(q.content.answer_key.correct) : '';
    // Xen kẽ: không chọn / chọn một phương án sai (kiểm tra chosen_option_trap)
    const wrong = lines.length % 2 === 1 ? options.find((o) => o.key !== correct)?.key ?? null : null;
    const vars = ExplainService.variablesOf(q, wrong, 'vi') as ExplainEvalLine['vars'];
    lines.push({ key: `${q.question_version_id}:${wrong ?? '_'}`, vars, gold: { correct_option: correct }, meta: { test_set: r.code, section: q.section_code, question_id: q.question_id } });
    if (opts.limit && lines.length >= opts.limit) break;
  }
  return lines;
}

/**
 * S169 – dòng eval explain_mcq cho dạng IELTS nhiều mục (C2): `options` có thể rỗng (điền từ/trả lời ngắn) nên ghi tệp riêng
 * `eval/data/explain_mcq_ielts_v1.jsonl` (schema dòng TOEIC `explainEvalLineSchema` đòi ≥ 2 options). `gold` = đáp án tóm tắt + đáp
 * án từng mục (describeQuestion); `vars` giống hệt production (`ExplainService.variablesOf`, có `items`/`instructions`).
 */
export interface ExplainIeltsEvalLine {
  key: string;
  vars: Record<string, unknown> & { section_code: string; question_type: string; correct_option: string; items: Array<{ key: string; text: string; correct: string; chosen: string | null }> };
  gold: { correct_option: string; items: Array<{ key: string; correct: string }> };
  meta: { source: 'fixture' | 'ielts_full'; fixture: string; variant: 'no_answer' | 'wrong' | 'partial'; section: string; test_set?: string };
}

/** Dạng thường gặp ở Listening (fixture đầu khớp lời thoại demo RL_DEMO_LISTENING – như seed ielts-question-types-demo) */
const IELTS_LISTENING_TYPES = new Set(['form_completion', 'note_completion', 'table_completion', 'plan_map_labelling', 'diagram_labelling', 'mcq_multi']);
/** 14 dạng IELTS R/L (C2) + TFNG/YNNG + trắc nghiệm một/hai đáp án – bỏ dạng chung S1 không thuộc định dạng IELTS (dictation, ordering…) */
const IELTS_EVAL_TYPES = new Set<string>([...RL_QUESTION_TYPE_CODES, 'tfng', 'mcq_multi', 'mcq_single']);

interface IeltsEvalSource {
  id: string;
  content: QuestionContent;
  wrong?: AnswerInput;
  partial?: AnswerInput;
  /** Fixture đầu mỗi dạng dùng chung đoạn văn/lời thoại demo → làm excerpt khi câu không có evidence */
  demoContext: boolean;
  /** C3 – câu của đề IELTS đầy đủ: passage/lời thoại thật của part + mã đề */
  full?: { test_set: string; section: string; listening: boolean; title: string; body: string };
}

function ieltsEvalSources(): IeltsEvalSource[] {
  const out: IeltsEvalSource[] = [];
  for (const [type, list] of Object.entries(QUESTION_FIXTURES_ALL)) {
    if (!IELTS_EVAL_TYPES.has(type)) continue;
    list.forEach((f, i) => {
      if (f.program !== 'ielts') return;
      out.push({ id: f.id, content: f.content, wrong: f.wrong_answer, partial: f.partial_answer, demoContext: i === 0 });
    });
  }
  // Câu mẫu bổ sung của đề demo C2 (trắc nghiệm Listening, TFNG, YNNG)
  RL_DEMO_EXTRA.forEach((f, i) => out.push({ id: `rl-demo-extra-${i + 1}`, content: questionContentSchema.parse(f.content), wrong: f.wrong_answer, partial: f.partial_answer, demoContext: true }));
  // C3 – đề IELTS Reading Academic 01 / Listening 01 tự biên soạn (chỉ biến thể không trả lời: nội dung không kèm câu trả lời mẫu)
  for (const t of IELTS_FULL_TESTS) {
    for (const sec of t.sections) {
      const listening = sec.passage.kind === 'audio_script';
      const body = sec.passage.kind === 'audio_script' ? sec.passage.segments.map((x) => `${x.name}: ${x.text}`).join('\n') : sec.passage.body;
      for (const q of sec.questions) out.push({ id: q.key, content: questionContentSchema.parse(q.content), demoContext: false, full: { test_set: t.code, section: sec.section_code, listening, title: sec.passage.title, body } });
    }
  }
  return out;
}

const LISTENING_TRANSCRIPT = RL_DEMO_LISTENING.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');

/**
 * Dựng dòng eval IELTS hoàn toàn offline (không cần DB): fixture tự biên soạn × (không trả lời | trả lời sai | đúng một phần) + câu của đề
 * IELTS đầy đủ (C3) × không trả lời.
 */
export function buildIeltsExplainDataset(): ExplainIeltsEvalLine[] {
  const lines: ExplainIeltsEvalLine[] = [];
  for (const src of ieltsEvalSources()) {
    const c = src.content;
    const listening = src.full ? src.full.listening : IELTS_LISTENING_TYPES.has(c.type) || (c.type === 'mcq_single' && src.id === 'rl-demo-extra-1');
    const section = src.full?.section ?? (listening ? 'listening_p1' : 'reading_p1');
    const body = src.full?.body ?? (src.demoContext ? (listening ? LISTENING_TRANSCRIPT : RL_DEMO_READING.body) : null);
    const title = src.full?.title ?? (listening ? RL_DEMO_LISTENING.title : RL_DEMO_READING.title);
    const q = {
      question_id: `fixture:${src.id}`,
      question_version_id: `fixture:${src.id}`,
      question_type: c.type,
      section_code: section,
      skill_code: listening ? 'listening' : 'reading',
      program_code: 'ielts',
      subskill_codes: [],
      content: c,
      passage: body ? { id: `fixture-passage:${section}`, kind: listening ? 'audio_script' : 'reading_passage', title, body, media_asset_id: null, parts: [] } : null,
    } as unknown as LoadedQuestion;
    const gold = describeQuestion(c);
    const goldItems = gold.items.map((i) => ({ key: i.key, correct: i.correct }));
    const variants: Array<['no_answer' | 'wrong' | 'partial', AnswerInput | null]> = [['no_answer', null], ['wrong', src.wrong ?? null], ['partial', src.partial ?? null]];
    for (const [variant, answer] of variants) {
      if (variant !== 'no_answer' && !answer) continue;
      const chosen = answer?.type === 'mcq_single' ? answer.selected : null;
      const vars = ExplainService.variablesOf(q, chosen, 'vi', answer && answer.type !== 'mcq_single' ? answer : null) as ExplainIeltsEvalLine['vars'];
      lines.push({ key: `fixture:${src.id}:${variant}`, vars, gold: { correct_option: gold.correct_text, items: goldItems }, meta: { source: src.full ? 'ielts_full' : 'fixture', fixture: src.id, variant, section, ...(src.full ? { test_set: src.full.test_set } : {}) } });
    }
  }
  return lines;
}
