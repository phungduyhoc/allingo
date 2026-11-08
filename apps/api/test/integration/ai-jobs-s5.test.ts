import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { CreditService } from '../../src/modules/billing/index.js';
import { AttemptSummaryService } from '../../src/modules/learning/index.js';
import { bootTestApp, client } from './setup.js';

const PASSWORD = 'Allingo@2026';
const INTERNAL = { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token' };
const uniq = () => Math.random().toString(36).slice(2, 8);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sprint 5 – job/stream AI: diagnose_rl (SSE + lưu + Exam Mode 403 + Free 403), summary.attempt sau mỗi 3 bài
 * (learn.notes system_summary, idempotent), content.generate (10 câu Part 5 "logistics" → draft source=ai + AI check + cờ trùng).
 */
describe('AI jobs S5 (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let part5SetId = '';
  let lrMiniSetId = '';
  let jobId = '';

  /** Làm + nộp một attempt trên đề mini Part 5 (chọn A cho mọi câu) */
  const doAttempt = async (api: ReturnType<typeof client>, mode: 'practice' | 'exam' = 'practice') => {
    const a = await api.call('POST', '/attempts', { program: 'toeic', mode, test_set_id: part5SetId }, { 'idempotency-key': crypto.randomUUID() });
    expect(a.status).toBe(201);
    const answers = a.body.questions.map((q: { question_id: string }, i: number) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: i % 3 === 0 ? 'A' : 'B' }, time_spent_ms: 8000 + i * 500 }));
    expect((await api.call('PUT', `/attempts/${a.body.id}/answers`, { answers })).status).toBe(204);
    const s = await api.call('POST', `/attempts/${a.body.id}/submit`);
    expect(s.status).toBe(200);
    return a.body.id as string;
  };

  beforeAll(async () => {
    process.env.JOBS_INLINE = 'true';
    app = await bootTestApp();
    dbs = app.get(DbService);
    const sets = await dbs.db.select({ id: schema.catalogTestSets.id, code: schema.catalogTestSets.code }).from(schema.catalogTestSets).where(inArray(schema.catalogTestSets.code, ['toeic-mini-part5-01', 'toeic-mini-lr-01']));
    part5SetId = sets.find((s) => s.code === 'toeic-mini-part5-01')!.id;
    lrMiniSetId = sets.find((s) => s.code === 'toeic-mini-lr-01')!.id;
  });

  afterAll(async () => {
    // Dọn câu AI sinh trong test (không làm lệch phát hiện trùng của các test khác)
    if (dbs) {
      const qs = await dbs.db.select({ id: schema.catalogQuestionVersions.questionId, vid: schema.catalogQuestionVersions.id }).from(schema.catalogQuestionVersions).where(like(sql`${schema.catalogQuestionVersions.metadata} ->> 'external_ref'`, 'ai-gen:%'));
      if (qs.length) {
        await dbs.db.delete(schema.aiEmbeddings).where(inArray(schema.aiEmbeddings.entityId, qs.map((q) => q.vid)));
        await dbs.db.delete(schema.catalogContentReviews).where(inArray(schema.catalogContentReviews.entityId, qs.map((q) => q.id)));
        await dbs.db.delete(schema.catalogQuestions).where(inArray(schema.catalogQuestions.id, [...new Set(qs.map((q) => q.id))]));
      }
    }
    delete process.env.JOBS_INLINE;
    await app?.close();
  });

  it('diagnose_rl: Pro → SSE result + lưu score_breakdown.ai_diagnosis (trừ credit 1 lần); GET đọc lại; gọi lại → cached', async () => {
    const pro = client(app);
    const login = await pro.call('POST', '/auth/login', { email: 'learner_pro@allingo.dev', password: PASSWORD });
    expect(login.status).toBe(200);
    await dbs.db.transaction((tx) => app.get(CreditService).grant(tx, login.body.user.id, 100, 'admin_adjust', { note: 'it-diagnosis' }));
    const attemptId = await doAttempt(pro);
    expect((await pro.call('GET', `/attempts/${attemptId}/diagnosis`)).status).toBe(404);
    const before = (await pro.call('GET', '/me/credits')).body.balance as number;
    const r = await pro.call('POST', `/attempts/${attemptId}/diagnosis`);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('text/event-stream');
    expect(r.raw).toContain('event: delta');
    const result = JSON.parse(/event: result\ndata: (.*)\n/.exec(r.raw)![1]!);
    expect(result.data).toMatchObject({ attempt_id: attemptId, cached: false, locale: 'vi' });
    expect(result.data.steps).toHaveLength(3);
    const after = (await pro.call('GET', '/me/credits')).body.balance as number;
    expect(before - after).toBe(10);
    const g = await pro.call('GET', `/attempts/${attemptId}/diagnosis`);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ attempt_id: attemptId, top_error_type: result.data.top_error_type, cached: true, ai_task_id: result.ai_task_id });
    const again = await pro.call('POST', `/attempts/${attemptId}/diagnosis`);
    expect(again.raw).toContain('"cached":true');
    expect((await pro.call('GET', '/me/credits')).body.balance).toBe(after);
    // input không chứa PII/đề nguyên văn ngoài phạm vi: ai_tasks.input_ref chỉ có attempt_id
    const [task] = await dbs.db.select().from(schema.aiAiTasks).where(eq(schema.aiAiTasks.id, result.ai_task_id));
    expect(task!.inputRef).toEqual({ attempt_id: attemptId });
    expect(task!.output).toMatchObject({ _redacted: true });

    // Exam Mode: đang làm đề exam khác → 403
    const exam = await pro.call('POST', '/attempts', { program: 'toeic', mode: 'exam', test_set_id: lrMiniSetId }, { 'idempotency-key': crypto.randomUUID() });
    expect(exam.status).toBe(201);
    const locked = await pro.call('POST', `/attempts/${attemptId}/diagnosis`);
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('exam_mode_locked');
    expect((await pro.call('POST', `/attempts/${exam.body.id}/submit`)).status).toBe(200);
    // người khác không xem được
    const stranger = client(app);
    await stranger.call('POST', '/auth/guest', {});
    expect((await stranger.call('GET', `/attempts/${attemptId}/diagnosis`)).status).toBe(404);
  });

  it('diagnose_rl: Free → 403 upgrade (seed: ai_diagnose chỉ Pro); attempt chưa chấm → 409', async () => {
    const free = client(app);
    await free.call('POST', '/auth/register', { email: `s5j-${uniq()}@example.com`, password: 'Hoc-vien#S12-xK9q', display_name: 'Free', accept_terms: true });
    const attemptId = await doAttempt(free);
    const r = await free.call('POST', `/attempts/${attemptId}/diagnosis`);
    expect(r.status).toBe(403);
    expect(r.body.error.details).toMatchObject({ feature: 'ai_diagnose', upgrade: true });
    const open = await free.call('POST', '/attempts', { program: 'toeic', mode: 'practice', test_set_id: part5SetId }, { 'idempotency-key': crypto.randomUUID() });
    expect((await free.call('POST', `/attempts/${open.body.id}/diagnosis`)).status).toBe(409);
  });

  it('summary.attempt: bài thứ 3 → learn.notes kind=system_summary (một lần, numeric fidelity); chạy lại → bỏ qua', async () => {
    const u = client(app);
    const reg = await u.call('POST', '/auth/register', { email: `s5s-${uniq()}@example.com`, password: 'Hoc-vien#S12-xK9q', display_name: 'Sum', accept_terms: true });
    const userId = reg.body.user.id as string;
    const ids = [await doAttempt(u), await doAttempt(u)];
    await wait(300);
    expect(await dbs.db.select().from(schema.learnNotes).where(and(eq(schema.learnNotes.userId, userId), eq(schema.learnNotes.kind, 'system_summary')))).toHaveLength(0);
    ids.push(await doAttempt(u));
    let notes: Array<typeof schema.learnNotes.$inferSelect> = [];
    for (let i = 0; i < 40 && notes.length === 0; i++) {
      await wait(150);
      notes = await dbs.db.select().from(schema.learnNotes).where(and(eq(schema.learnNotes.userId, userId), eq(schema.learnNotes.kind, 'system_summary')));
    }
    expect(notes).toHaveLength(1);
    const data = notes[0]!.data as { attempt_id: string; attempt_ids: string[]; summary: { headline: string; weakest: { evidence: string } }; ai_task_id: string };
    expect(data.attempt_id).toBe(ids[2]);
    expect(data.attempt_ids).toHaveLength(3);
    expect(notes[0]!.body).toContain(data.summary.headline);
    expect(data.summary.weakest.evidence).toMatch(/^wrong \d+\/\d+ in /);
    const [task] = await dbs.db.select().from(schema.aiAiTasks).where(eq(schema.aiAiTasks.id, data.ai_task_id));
    expect(task).toMatchObject({ taskCode: 'summarize_attempt', creditsCharged: 0, status: 'succeeded' });
    const svc = app.get(AttemptSummaryService);
    expect(await svc.run({ attempt_id: ids[2]!, user_id: userId, program: 'toeic' })).toMatchObject({ skipped: 'exists' });
    expect(await svc.maybeEnqueue({ attempt_id: ids[1]!, user_id: userId, program: 'toeic' })).toBeNull();
  });

  it('content.generate: 10 câu Part 5 "logistics" → 10 draft source=ai, có kết quả check, câu trùng ngân hàng bị gắn cờ', async () => {
    const admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    const start = await admin.call('POST', '/admin/generate/questions', { program: 'toeic', section: 'part5', question_type: 'mcq_single', topic: 'logistics', difficulty: 'B1', count: 10 });
    expect(start.status).toBe(202);
    expect(start.body).toMatchObject({ status: 'queued', mode: 'inline' });
    jobId = start.body.job_id;
    let job: Record<string, unknown> = {};
    for (let i = 0; i < 120 && job.status !== 'completed' && job.status !== 'failed'; i++) {
      await wait(250);
      job = (await admin.call('GET', `/admin/generate/questions/${jobId}`)).body;
    }
    expect(job.status).toBe('completed');
    const result = job.result as { items: Array<Record<string, unknown> & { duplicate: { flagged: boolean; method: string; similarity: number; of_question_id: string } }>; summary: Record<string, unknown> };
    expect(result.summary).toMatchObject({ requested: 10, generated: 10, created: 10, invalid: 0, mock: true, cosine_threshold: 0.92 });
    expect(result.items.every((i) => i.status === 'created' && i.verdict === 'pass' && i.workflow_status === 'ai_checked')).toBe(true);
    const flagged = result.items.filter((i) => i.duplicate.flagged);
    const bankDup = flagged.filter((i) => i.duplicate.method === 'embedding');
    expect(bankDup.length).toBeGreaterThanOrEqual(1);
    expect(bankDup[0]!.duplicate.similarity).toBeGreaterThanOrEqual(0.92);
    // 9 câu còn lại khác nhau (không trùng trong lô / ngân hàng)
    expect(flagged).toHaveLength(bankDup.length);
    const [orig] = await dbs.db.select({ status: schema.catalogQuestions.status }).from(schema.catalogQuestions).where(eq(schema.catalogQuestions.id, bankDup[0]!.duplicate.of_question_id));
    expect(orig!.status).toBe('published');
    const created = await dbs.db
      .select({ q: schema.catalogQuestions, meta: schema.catalogQuestionVersions.metadata })
      .from(schema.catalogQuestionVersions)
      .innerJoin(schema.catalogQuestions, eq(schema.catalogQuestions.id, schema.catalogQuestionVersions.questionId))
      .where(like(sql`${schema.catalogQuestionVersions.metadata} ->> 'external_ref'`, `ai-gen:${jobId}:%`));
    expect(created).toHaveLength(10);
    expect(created.every((c) => c.q.source === 'ai' && c.q.status === 'ai_checked')).toBe(true);
    expect(created.filter((c) => (c.meta as { duplicate?: { flagged?: boolean } }).duplicate?.flagged)).toHaveLength(flagged.length);
    const reviews = await dbs.db.select().from(schema.catalogContentReviews).where(and(inArray(schema.catalogContentReviews.entityId, created.map((c) => c.q.id)), eq(schema.catalogContentReviews.stage, 'ai_check')));
    expect(reviews).toHaveLength(10);
    const [emb] = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(schema.aiEmbeddings).where(eq(schema.aiEmbeddings.model, 'mock:hash-trigram-1536'));
    expect(emb!.n).toBeGreaterThanOrEqual(40);
    // Học viên không được gọi
    const learner = client(app);
    await learner.call('POST', '/auth/guest', {});
    expect((await learner.call('POST', '/admin/generate/questions', { program: 'toeic', section: 'part5', question_type: 'mcq_single', count: 1 })).status).toBe(403);
  });

  it('CMS nội bộ: /internal/content/questions/generate theo apiUserEmail (thiếu vai trò → 403), polling trạng thái', async () => {
    const f = app.getHttpAdapter().getInstance();
    const bad = await f.inject({ method: 'POST', url: '/v1/internal/content/questions/generate', headers: { ...INTERNAL, 'content-type': 'application/json' }, payload: { program: 'toeic', section: 'part5', question_type: 'mcq_single', count: 2, requested_by_email: 'learner_free@allingo.dev' } });
    expect(bad.statusCode).toBe(403);
    const ok = await f.inject({ method: 'POST', url: '/v1/internal/content/questions/generate', headers: { ...INTERNAL, 'content-type': 'application/json' }, payload: { program: 'toeic', section: 'part5', question_type: 'mcq_single', topic: 'warehouse', count: 2, requested_by_email: 'admin@allingo.dev' } });
    expect(ok.statusCode).toBe(202);
    const id = ok.json().job_id as string;
    let st: Record<string, unknown> = {};
    for (let i = 0; i < 80 && st.status !== 'completed'; i++) {
      await wait(200);
      st = (await f.inject({ method: 'GET', url: `/v1/internal/content/questions/generate/${id}`, headers: INTERNAL })).json();
    }
    expect(st.status).toBe('completed');
    expect((st.result as { summary: { created: number } }).summary.created).toBe(2);
    expect((await f.inject({ method: 'GET', url: `/v1/internal/content/questions/generate/${id}` })).statusCode).toBe(401);
  });
});
