import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { OutboxService } from '../../src/shared/events/outbox.service.js';
import { SearchService } from '../../src/modules/catalog/index.js';
import { bootTestApp, client } from './setup.js';

const uniq = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Allingo@2026';
const INTERNAL = { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token' };

const part5 = (stem: string, correct: 'A' | 'B' | 'C' | 'D' = 'B') => ({
  type: 'mcq_single' as const,
  stem,
  options: [
    { key: 'A', text: 'pay' },
    { key: 'B', text: 'paid' },
    { key: 'C', text: 'paying' },
    { key: 'D', text: 'payment' },
  ],
  answer_key: { correct },
  explanation: { vi: 'Bị động "must be + V3".', en: 'Passive "must be + V3".' },
  tags: ['grammar:passive'],
});

/**
 * Sprint 2 – vòng đời nội dung trong catalog: tạo → AI kiểm tra → duyệt vòng 1 (teacher) → vòng 2 (admin, 4 mắt) → phát hành,
 * phiên bản (attempt cũ giữ bản cũ), nhập hàng loạt phát hiện trùng, cấu trúc bộ đề, tìm kiếm (PG provider ở test).
 */
describe('content workflow (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  const editor = () => client(app);
  let editorApi: ReturnType<typeof client>;
  let teacherApi: ReturnType<typeof client>;
  let adminApi: ReturnType<typeof client>;
  let learnerApi: ReturnType<typeof client>;
  const token = uniq();
  const keyword = `invoice${token}`;

  beforeAll(async () => {
    process.env.SEARCH_PROVIDER = 'pg';
    app = await bootTestApp();
    dbs = app.get(DbService);
    adminApi = client(app);
    expect((await adminApi.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    teacherApi = client(app);
    expect((await teacherApi.call('POST', '/auth/login', { email: 'teacher@allingo.dev', password: PASSWORD })).status).toBe(200);
    // Biên tập viên: đăng ký rồi được admin cấp vai trò editor (claims vai trò có hiệu lực ở lần đăng nhập kế tiếp)
    editorApi = editor();
    const email = `editor-${token}@example.com`;
    const reg = await editorApi.call('POST', '/auth/register', { email, password: 'Password123!', display_name: 'Editor', accept_terms: true });
    expect((await adminApi.call('POST', `/admin/users/${reg.body.user.id}/roles`, { role_code: 'editor' })).status).toBe(200);
    expect((await editorApi.call('POST', '/auth/login', { email, password: 'Password123!' })).body.user.roles).toContain('editor');
    learnerApi = client(app);
    await learnerApi.call('POST', '/auth/guest', {});
  });
  afterAll(async () => {
    await app?.close();
  });

  const relay = () => app.get(OutboxService).relayBatch(500);

  it('editor tạo câu Part 5 → AI kiểm tra → teacher duyệt 1 → admin duyệt 2 → xuất hiện ở /practice/questions; học viên không gọi được admin', async () => {
    const created = await editorApi.call('POST', '/admin/questions', { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', topic_code: undefined, content: part5(`The ${keyword} must be ______ before the end of the month.`) });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body.status).toBe('draft');
    expect(created.body.head_version.version_no).toBe(1);
    expect((await learnerApi.call('GET', '/admin/questions')).status).toBe(403);

    // Con người không được tự đặt ai_check
    const manual = await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'ai_check', decision: 'approve' });
    expect(manual.status).toBe(409);
    expect(manual.body.error.details.reason).toBe('ai_check_only');

    const ai = await editorApi.call('POST', `/admin/questions/${id}/ai-check`);
    expect(ai.status).toBe(200);
    expect(ai.body.ai_check.verdict).toBe('pass');
    expect(ai.body.question.status).toBe('ai_checked');

    // Chưa phát hành → người học chưa thấy
    const before = await learnerApi.call('GET', `/practice/questions?program=toeic&section=part5&q=${keyword}&count=5`);
    expect(before.status).toBe(404);

    expect((await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'submit' })).body.status).toBe('review1');
    // editor không được duyệt
    expect((await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'approve' })).status).toBe(403);
    expect((await teacherApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'approve' })).body.status).toBe('review2');
    // teacher không duyệt vòng 2
    expect((await teacherApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review2', decision: 'approve' })).status).toBe(403);
    const pub = await adminApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review2', decision: 'approve', notes: 'OK' });
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');

    const reviews = await dbs.db.select().from(schema.catalogContentReviews).where(eq(schema.catalogContentReviews.entityId, id));
    expect(reviews.map((r) => `${r.stage}:${r.decision}`).sort()).toEqual(['ai_check:approve', 'review1:approve', 'review2:approve']);
    expect(reviews.find((r) => r.stage === 'ai_check')?.reviewerId).toBeNull();
    const outbox = await dbs.db.select().from(schema.opsOutbox).where(and(eq(schema.opsOutbox.aggregateId, id), eq(schema.opsOutbox.eventType, 'content.published')));
    expect(outbox).toHaveLength(1);

    const after = await learnerApi.call('GET', `/practice/questions?program=toeic&section=part5&q=${keyword}&count=5`);
    expect(after.status).toBe(201);
    expect(after.body.questions).toHaveLength(1);
    expect(after.body.questions[0].question_id).toBe(id);
    expect(after.body.questions[0].content.answer_key).toBeUndefined();
    await relay();
  });

  it('reject ở review1 → rejected (cần ghi chú); needs_change → draft kèm ghi chú; mở lại từ rejected', async () => {
    const c = await editorApi.call('POST', '/admin/questions', { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: part5(`Draft only ${token} ______ text for review.`) });
    const id = c.body.id as string;
    await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'submit' });
    expect((await teacherApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'needs_change' })).body.error.details.reason).toBe('note_required');
    const back = await teacherApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'needs_change', notes: 'Phương án D gây nhiễu yếu' });
    expect(back.body.status).toBe('draft');
    const [r] = await dbs.db.select().from(schema.catalogContentReviews).where(and(eq(schema.catalogContentReviews.entityId, id), eq(schema.catalogContentReviews.decision, 'needs_change')));
    expect(r?.notes).toBe('Phương án D gây nhiễu yếu');
    await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'submit' });
    const rej = await teacherApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'reject', notes: 'Trùng nội dung' });
    expect(rej.body.status).toBe('rejected');
    expect((await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'reopen' })).body.status).toBe('draft');
    // Bản nháp không bao giờ lộ qua tìm kiếm
    const hits = await app.get(SearchService).searchQuestions(`Draft only ${token}`, { program: 'toeic' });
    expect(hits.map((h) => h.id)).not.toContain(id);
  });

  it('nguyên tắc 4 mắt: admin đã duyệt vòng 1 thì không được duyệt vòng 2', async () => {
    const c = await editorApi.call('POST', '/admin/questions', { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: part5(`Four eyes ${token} ______ check.`) });
    const id = c.body.id as string;
    await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'submit' });
    await adminApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'approve' });
    const r = await adminApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review2', decision: 'approve' });
    expect(r.status).toBe(403);
    expect(r.body.error.details.reason).toBe('four_eyes');
  });

  it('sửa câu đã phát hành → phiên bản 2 chờ duyệt; người học vẫn thấy v1; attempt cũ xem lại đúng v1 sau khi v2 phát hành', async () => {
    const stem1 = `Version ${token} report must be ______ by Friday.`;
    const c = await editorApi.call('POST', '/admin/questions', { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: part5(stem1) });
    const id = c.body.id as string;
    await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'submit' });
    await teacherApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'approve' });
    const v1 = await adminApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review2', decision: 'approve' });
    const v1Id = v1.body.current_version_id as string;

    // Người học làm drill có câu này (v1)
    const drill = await learnerApi.call('GET', `/practice/questions?program=toeic&section=part5&q=${encodeURIComponent(`Version ${token}`)}&count=1`);
    expect(drill.status).toBe(201);
    const attemptId = drill.body.id as string;
    expect(drill.body.questions[0].question_version_id).toBe(v1Id);
    await learnerApi.call('PUT', `/attempts/${attemptId}/answers`, { answers: [{ question_id: id, answer: { type: 'mcq_single', selected: 'B' }, time_spent_ms: 1000 }] });
    expect((await learnerApi.call('POST', `/attempts/${attemptId}/submit`)).status).toBe(200);

    // Sửa: v2 chờ duyệt, người học vẫn thấy v1
    const stem2 = `Version ${token} report has to be ______ by Friday noon.`;
    const nv = await editorApi.call('POST', `/admin/questions/${id}/versions`, { content: part5(stem2, 'B'), change_note: 'Làm rõ thời hạn' });
    expect(nv.status).toBe(201);
    expect(nv.body.status).toBe('published');
    expect(nv.body.has_pending_version).toBe(true);
    expect(nv.body.workflow_status).toBe('draft');
    expect(nv.body.head_version.version_no).toBe(2);
    expect(nv.body.current_version_id).toBe(v1Id);
    const stillV1 = await learnerApi.call('GET', `/practice/questions?program=toeic&section=part5&q=${encodeURIComponent(`Version ${token}`)}&count=1`);
    expect(stillV1.body.questions[0].question_version_id).toBe(v1Id);

    // Duyệt v2
    await editorApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'submit' });
    await teacherApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review1', decision: 'approve' });
    const v2 = await adminApi.call('POST', `/admin/content/question/${id}/review`, { stage: 'review2', decision: 'approve' });
    expect(v2.body.has_pending_version).toBe(false);
    expect(v2.body.current_version_id).not.toBe(v1Id);

    const versions = await adminApi.call('GET', `/admin/questions/${id}/versions`);
    expect(versions.body.map((v: { version_no: number }) => v.version_no)).toEqual([2, 1]);
    expect(versions.body.every((v: { published_at: string | null }) => !!v.published_at)).toBe(true);

    // Attempt cũ vẫn xem lại bằng v1
    const review = await learnerApi.call('GET', `/attempts/${attemptId}/review`);
    expect(review.status).toBe(200);
    expect(review.body.items[0].question.question_version_id).toBe(v1Id);
    expect(review.body.items[0].question.content.stem).toBe(stem1);
  });

  it('nhập hàng loạt: 50 câu có 2 câu trùng (1 trong lô, 1 với catalog) → báo đúng 2 dòng', async () => {
    const existingStem = `The ${keyword} must be ______ before the end of the month.`;
    // 48 câu khác nhau thật sự (từ ngẫu nhiên xác định) + 1 câu trùng trong lô + 1 câu trùng với catalog
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const word = () => Array.from({ length: 5 + Math.floor(rnd() * 4) }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd() * 26)]).join('');
    const stems = Array.from({ length: 48 }, () => `${word()} ${word()} ${word()} ______ ${word()} ${word()} ${word()}.`);
    stems.splice(10, 0, stems[3]!.replace('______', '____').toUpperCase());
    stems.push(existingStem.replace('must be', 'must  be'));
    expect(stems).toHaveLength(50);
    const r = await adminApi.call('POST', '/internal/content/questions/duplicates', { program: 'toeic', stems }, INTERNAL);
    expect(r.status).toBe(200);
    expect(r.body.in_batch.map((d: { index: number; duplicate_of: number }) => [d.index, d.duplicate_of])).toEqual([[10, 3]]);
    expect(r.body.existing.map((d: { index: number }) => d.index)).toEqual([49]);
    expect(r.body.existing[0].similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('CMS sync: lưu nháp, ghi review theo email người duyệt, phát hành và sửa nội dung → version mới', async () => {
    const ref = `cms-${token}`;
    const base = { external_ref: ref, program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: part5(`CMS ${token} draft ______ sync.`) };
    const d = await adminApi.call('POST', '/internal/content/questions/sync', { ...base, status: 'draft', created_by_email: 'admin@allingo.dev' }, INTERNAL);
    expect(d.status).toBe(200);
    expect(d.body.status).toBe('draft');
    const qid = d.body.question_id as string;
    await adminApi.call('POST', '/internal/content/questions/sync', { ...base, status: 'review1', review: { stage: 'review1', decision: 'submit', reviewer_email: 'admin@allingo.dev' } }, INTERNAL);
    await adminApi.call('POST', '/internal/content/questions/sync', { ...base, status: 'review2', review: { stage: 'review1', decision: 'approve', reviewer_email: 'teacher@allingo.dev', notes: 'ok' } }, INTERNAL);
    const p = await adminApi.call('POST', '/internal/content/questions/sync', { ...base, status: 'published', review: { stage: 'review2', decision: 'approve', reviewer_email: 'admin@allingo.dev' } }, INTERNAL);
    expect(p.body.version_no).toBe(1);
    const [q] = await dbs.db.select().from(schema.catalogQuestions).where(eq(schema.catalogQuestions.id, qid));
    expect(q?.status).toBe('published');
    const reviews = await dbs.db.select().from(schema.catalogContentReviews).where(eq(schema.catalogContentReviews.entityId, qid));
    expect(reviews).toHaveLength(2);
    expect(reviews.every((r) => !!r.reviewerId)).toBe(true);
    // Sửa nội dung câu đã phát hành (teacher/admin trong CMS) → v2 phát hành ngay
    const v2 = await adminApi.call('POST', '/internal/content/questions/publish', { ...base, content: part5(`CMS ${token} edited ______ sync.`) }, INTERNAL);
    expect(v2.body.version_no).toBe(2);
    expect(v2.body.changed).toBe(true);
    const same = await adminApi.call('POST', '/internal/content/questions/publish', { ...base, content: part5(`CMS ${token} edited ______ sync.`) }, INTERNAL);
    expect(same.body.changed).toBe(false);
    expect(same.body.version_no).toBe(2);
  });

  it('kiểm tra cấu trúc bộ đề: full thiếu câu → lỗi; mini hợp lệ', async () => {
    const items = Array.from({ length: 29 }, (_, i) => ({ question_external_ref: `q${i}`, section_code: 'part5', sort_order: i + 1 }));
    const full = await adminApi.call('POST', '/internal/content/test-sets/validate', { program: 'toeic', kind: 'full', items }, INTERNAL);
    expect(full.body.ok).toBe(false);
    expect(full.body.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['count_mismatch', 'missing_section']));
    const mini = await adminApi.call('POST', '/internal/content/test-sets/validate', { program: 'toeic', kind: 'mini', items: items.slice(0, 10) }, INTERNAL);
    expect(mini.body.ok).toBe(true);
    const pub = await adminApi.call('POST', '/internal/content/test-sets/publish', { external_ref: 'x', program: 'toeic', code: `bad-${token}`, title: { vi: 'x' }, kind: 'full', sections: [{ section_code: 'part5' }], items }, INTERNAL);
    expect(pub.status).toBe(400);
  });

  it('tìm kiếm PG: "invoice<token>" ra câu đã phát hành; tài liệu index không chứa đáp án', async () => {
    const search = app.get(SearchService);
    const hits = await search.searchQuestions(keyword, { program: 'toeic' });
    expect(hits.length).toBe(1);
    const docs = await search.buildDocs([hits[0]!.id]);
    expect(docs).toHaveLength(1);
    const json = JSON.stringify(docs[0]);
    expect(json).toContain(keyword);
    expect(json).not.toContain('answer_key');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('"correct"');
  });
});
