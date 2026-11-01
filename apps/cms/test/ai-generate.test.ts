import { describe, expect, it } from 'vitest';
import { aiGenerateBodySchema, importGenerated, toPayloadQuestion, type PayloadQuestionData, type QuestionStore } from '../src/lib/ai-generate';
import type { GeneratedItem } from '../src/lib/internal-api';

const dup = (flagged: boolean) => ({ flagged, method: flagged ? ('embedding' as const) : null, of_question_id: flagged ? 'q-pub-1' : null, of_index: null, similarity: flagged ? 1 : null, embedding_similarity: flagged ? 1 : 0.3, trigram_similarity: null });
const item = (i: number, over: Partial<GeneratedItem> = {}): GeneratedItem => ({
  index: i,
  status: 'created',
  question_id: `q-${i}`,
  question_version_id: `v-${i}`,
  external_ref: `ai-gen:job-1:${i + 1}`,
  workflow_status: 'ai_checked',
  verdict: 'pass',
  issues: [],
  ai_check_task_id: `t-${i}`,
  duplicate: dup(false),
  content: { type: 'mcq_single', stem: `The logistics team ______ item ${i}.`, options: [{ key: 'A', text: 'will review' }, { key: 'B', text: 'reviewed' }], answer_key: { correct: 'A' }, tags: [] },
  ...over,
});

/** Giả lập Payload Local API (find theo externalRef + create) */
function memoryStore() {
  const docs: Array<PayloadQuestionData & { id: string }> = [];
  const store: QuestionStore = {
    findByExternalRef: async (ref) => docs.find((d) => d.externalRef === ref) ?? null,
    create: async (data) => {
      const doc = { ...data, id: `cms-${docs.length + 1}` };
      docs.push(doc);
      return doc;
    },
  };
  return { docs, store };
}

describe('CMS – Sinh câu hỏi bằng AI (S5)', () => {
  it('validate body: mặc định toeic/mcq_single/10, count 1–50, cần sectionCode', () => {
    expect(aiGenerateBodySchema.parse({ sectionCode: 'part5' })).toMatchObject({ program: 'toeic', questionType: 'mcq_single', count: 10 });
    expect(aiGenerateBodySchema.safeParse({ sectionCode: 'part5', count: 51 }).success).toBe(false);
    expect(aiGenerateBodySchema.safeParse({ count: 5 }).success).toBe(false);
    expect(aiGenerateBodySchema.parse({ sectionCode: 'part5', count: '3', topic: '  logistics ' })).toMatchObject({ count: 3, topic: 'logistics' });
  });

  it('ánh xạ sang document Payload: source=ai, externalRef của catalog, trạng thái theo AI check, cờ trùng vào aiReport + ghi chú', () => {
    const body = aiGenerateBodySchema.parse({ sectionCode: 'part5', topic: 'logistics', difficulty: 'B1' });
    const d = toPayloadQuestion(item(9, { duplicate: dup(true), verdict: 'needs_change', workflow_status: 'ai_checked' }), body)!;
    expect(d).toMatchObject({ source: 'ai', externalRef: 'ai-gen:job-1:10', status: 'ai_checked', sectionCode: 'part5', topicCode: 'logistics', difficulty: 'B1' });
    expect(d.aiReport).toMatchObject({ verdict: 'needs_change', duplicate: { flagged: true, method: 'embedding' }, source: 'ai_generate' });
    expect(d.reviewNote).toContain('Nghi trùng');
    expect(toPayloadQuestion(item(1, { workflow_status: 'draft', verdict: 'fail' }), body)!.status).toBe('draft');
    expect(toPayloadQuestion(item(2, { status: 'invalid', external_ref: null, content: null }), body)).toBeNull();
  });

  it('nhập idempotent theo externalRef (polling lặp không tạo trùng); câu invalid không nhập', async () => {
    const { docs, store } = memoryStore();
    const body = aiGenerateBodySchema.parse({ sectionCode: 'part5' });
    const items = [item(0), item(1, { duplicate: dup(true) }), item(2, { status: 'invalid', external_ref: null, content: null, verdict: null, errors: ['options: too small'] })];
    const first = await importGenerated(store, items, body);
    expect(first.filter((x) => x.imported)).toHaveLength(2);
    expect(first[1]).toMatchObject({ cmsId: 'cms-2', duplicate: { flagged: true } });
    expect(first[2]).toMatchObject({ imported: false, cmsId: null, errors: ['options: too small'] });
    const again = await importGenerated(store, items, body);
    expect(again.filter((x) => x.imported)).toHaveLength(0);
    expect(again[0]!.cmsId).toBe('cms-1');
    expect(docs).toHaveLength(2);
  });

  it('lỗi tạo một câu không chặn các câu còn lại', async () => {
    let n = 0;
    const store: QuestionStore = { findByExternalRef: async () => null, create: async () => (n++ === 0 ? Promise.reject(new Error('validation')) : { id: 'ok' }) };
    const r = await importGenerated(store, [item(0), item(1)], aiGenerateBodySchema.parse({ sectionCode: 'part5' }));
    expect(r[0]).toMatchObject({ imported: false, errors: ['validation'] });
    expect(r[1]).toMatchObject({ imported: true, cmsId: 'ok' });
  });
});
