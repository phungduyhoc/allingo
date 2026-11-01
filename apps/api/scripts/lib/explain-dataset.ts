/**
 * Dựng tập eval explain_mcq từ ngân hàng PUBLISHED demo (Reading 01, Listening 01 Part 3/4, Part 5 demo – S5 mục 9).
 * Biến giống hệt production (`ExplainService.variablesOf`): đáp án đúng + giải thích tác giả + trích passage/transcript chỉ ở
 * những trường mà template explain_mcq cho phép; bỏ Part 1/2 (chữ của câu nằm trong audio – A40). Không PII.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { DbService } from '../../src/shared/db/db.module.js';
import { ExplainService, type ExplainEvalLine } from '../../src/modules/ai-gateway/index.js';
import type { CatalogQueryService } from '../../src/modules/catalog/index.js';

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
