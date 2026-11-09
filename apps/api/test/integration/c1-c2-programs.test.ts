import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, inArray } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { IELTS_DEMO_CODE } from '@allingo/db/seed';
import { ieltsListeningBand, ieltsReadingBand } from '@allingo/scoring';
import { grade, keyAnswerOf, markCount, questionContentSchema, type AnswerInput, type QuestionContent } from '@allingo/schemas';
import { DbService } from '../../src/shared/db/db.module.js';
import { bootTestApp, client } from './setup.js';

const PASSWORD = 'Allingo@2026';
const uniq = () => Math.random().toString(36).slice(2, 8);
const IELTS_FLAG = 'ff.catalog.program.ielts';

interface PublicQ {
  question_id: string;
  question_version_id: string;
  section_code: string;
  content: { type: string; answer_key?: unknown };
}

/** Câu trả lời sai/trống hợp lệ theo dạng (không trả lời mục nào) */
function blankAnswer(c: QuestionContent): AnswerInput {
  switch (c.type) {
    case 'mcq_single':
      return { type: 'mcq_single', selected: c.options.find((o) => o.key !== c.answer_key.correct)!.key };
    case 'mcq_multi':
      return { type: 'mcq_multi', selected: [] };
    case 'tfng':
      return { type: 'tfng', values: {} };
    case 'summary_word_bank':
      return { type: 'summary_word_bank', gaps: {} };
    case 'plan_map_labelling':
      return { type: 'plan_map_labelling', values: {} };
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
      return { type: c.type, pairs: {} };
    default:
      return { type: c.type, gaps: {} } as AnswerInput;
  }
}

/**
 * C1 + C2 (integration, Postgres/Redis thật, AI mock): chương trình đang học (PATCH /me active_program, enrollment is_current),
 * GET /programs trạng thái theo cờ ra mắt + số đề phát hành, chấm đề mẫu IELTS 18 câu (14 dạng mới) theo mục đánh số → band,
 * xem lại/feedback có `details` từng mục, không lộ đáp án khi đang làm bài, giải thích AI nhận câu trả lời nhiều mục (khoá cache).
 */
describe('C1/C2 – đa chương trình & dạng câu IELTS (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let admin: ReturnType<typeof client>;
  let learner: ReturnType<typeof client>;
  let learnerId = '';
  let testSetId = '';
  let flagBefore: { enabled: boolean; rules: unknown } | null = null;
  const versions = new Map<string, QuestionContent>();

  beforeAll(async () => {
    // Không phụ thuộc .env cục bộ (CI không có .env)
    process.env.JOBS_INLINE = 'true';
    process.env.CATALOG_CACHE_TTL_SECONDS = '0';
    app = await bootTestApp();
    dbs = app.get(DbService);
    admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    const f = await admin.call('GET', `/admin/flags/${IELTS_FLAG}`);
    if (f.status === 200) flagBefore = { enabled: !!f.body.enabled, rules: f.body.rules ?? {} };
    learner = client(app);
    const email = `c1-learner-${uniq()}@example.com`;
    const reg = await learner.call('POST', '/auth/register', { email, password: 'Hoc-vien#C1-zQ8w', display_name: 'Learner C1', accept_terms: true });
    expect(reg.status).toBe(201);
    learnerId = reg.body.user.id as string;
    const [ts] = await dbs.db.select({ id: schema.catalogTestSets.id, program: schema.catalogTestSets.programCode }).from(schema.catalogTestSets).where(eq(schema.catalogTestSets.code, IELTS_DEMO_CODE));
    expect(ts?.program).toBe('ielts');
    testSetId = ts!.id;
  });

  afterAll(async () => {
    // Trả cờ ra mắt IELTS về như trước test (seed: tắt)
    if (admin) await admin.call('PUT', `/admin/flags/${IELTS_FLAG}`, flagBefore ?? { enabled: false, rules: {} });
    delete process.env.JOBS_INLINE;
    delete process.env.CATALOG_CACHE_TTL_SECONDS;
    await app?.close();
  });

  // ------------------------------------------------------------------ C1
  it('GET /programs: TOEIC available; IELTS coming_soon khi cờ tắt → available khi bật cờ (có đề phát hành); JLPT/HSK coming_soon', async () => {
    expect((await admin.call('PUT', `/admin/flags/${IELTS_FLAG}`, { enabled: false, rules: {} })).status).toBe(200);
    const off = await learner.call('GET', '/programs');
    expect(off.status).toBe(200);
    const by = (body: Array<{ code: string; status?: string; published_test_sets?: number; phase?: number; skills?: string[] }>) => new Map(body.map((p) => [p.code, p]));
    const p0 = by(off.body);
    expect(p0.get('toeic')).toMatchObject({ status: 'available', phase: 1 });
    expect(p0.get('ielts')).toMatchObject({ status: 'coming_soon', phase: 2, skills: ['listening', 'reading', 'writing', 'speaking'] });
    expect(p0.get('ielts')!.published_test_sets).toBeGreaterThanOrEqual(1);
    expect(p0.get('jlpt')?.status).toBe('coming_soon');
    expect(p0.get('hsk')?.status).toBe('coming_soon');

    expect((await admin.call('PUT', `/admin/flags/${IELTS_FLAG}`, { enabled: true, rules: {} })).status).toBe(200);
    const on = by((await learner.call('GET', '/programs')).body);
    expect(on.get('ielts')?.status).toBe('available');
    // Ẩn danh cũng xem được trạng thái
    expect(by((await client(app).call('GET', '/programs')).body).get('ielts')?.status).toBe('available');
  });

  it('PATCH /me active_program: lưu tường minh, tạo enrollment, is_current đổi theo; mã sai 400; GET /me trả active_program', async () => {
    const r1 = await learner.call('PATCH', '/me', { active_program: 'ielts' });
    expect(r1.status).toBe(200);
    expect(r1.body.active_program).toBe('ielts');
    expect((await learner.call('GET', '/me')).body.active_program).toBe('ielts');
    const e1 = (await learner.call('GET', '/me/enrollments')).body as Array<{ program: string; is_current?: boolean }>;
    expect(e1.find((e) => e.program === 'ielts')).toMatchObject({ is_current: true });

    // Đổi mục tiêu TOEIC không làm TOEIC thành "đang học" (trước C1: suy từ enrollment cập nhật gần nhất)
    expect((await learner.call('POST', '/me/enrollments', { program: 'toeic', target_score: 750 })).status).toBe(201);
    expect((await learner.call('GET', '/me')).body.active_program).toBe('ielts');

    const r2 = await learner.call('PATCH', '/me', { active_program: 'toeic' });
    expect(r2.body.active_program).toBe('toeic');
    const e2 = (await learner.call('GET', '/me/enrollments')).body as Array<{ program: string; is_current?: boolean; target_score?: number | null }>;
    expect(e2.find((e) => e.program === 'toeic')).toMatchObject({ is_current: true, target_score: 750 });
    expect(e2.find((e) => e.program === 'ielts')?.is_current).toBe(false);
    expect((await learner.call('PATCH', '/me', { active_program: 'klingon' })).status).toBe(400);
    const [u] = await dbs.db.select({ p: schema.iamUsers.activeProgram }).from(schema.iamUsers).where(eq(schema.iamUsers.id, learnerId));
    expect(u?.p).toBe('toeic');
  });

  // ------------------------------------------------------------------ C2
  it('đề mẫu IELTS: 14 dạng mới + mcq/tfng; nội dung khi làm bài không lộ answer_key/accepted', async () => {
    const a = await learner.call('POST', '/attempts', { program: 'ielts', mode: 'exam', test_set_id: testSetId }, { 'idempotency-key': randomUUID() });
    expect(a.status).toBe(201);
    const qs = a.body.questions as PublicQ[];
    expect(qs).toHaveLength(18);
    const types = new Set(qs.map((q) => q.content.type));
    for (const t of ['matching_headings', 'matching_information', 'matching_features', 'matching_sentence_endings', 'sentence_completion', 'summary_completion', 'note_completion', 'table_completion', 'flow_chart_completion', 'form_completion', 'summary_word_bank', 'diagram_labelling', 'plan_map_labelling', 'short_answer', 'tfng', 'mcq_multi']) expect(types, t).toContain(t);
    const json = JSON.stringify(a.body.questions);
    expect(json).not.toContain('answer_key');
    expect(json).not.toContain('"accepted"');
    // Exam Mode: giải thích AI bị khoá khi đang làm bài thi
    expect((await learner.call('POST', '/ai/explain', { question_version_id: qs[7]!.question_version_id, answer: blankAnswer(questionContentSchema.parse({ type: 'tfng', statements: [{ key: '1', text: 'x' }], answer_key: { values: { '1': 'true' } } })) })).status).toBe(403);
    await learner.call('POST', `/attempts/${a.body.id}/submit`);
  });

  it('chấm theo mục đánh số → band IELTS; review/feedback có details từng mục', async () => {
    const a = await learner.call('POST', '/attempts', { program: 'ielts', mode: 'exam', test_set_id: testSetId }, { 'idempotency-key': randomUUID() });
    expect(a.status).toBe(201);
    const qs = a.body.questions as PublicQ[];
    const rows = await dbs.db.select({ id: schema.catalogQuestionVersions.id, content: schema.catalogQuestionVersions.content }).from(schema.catalogQuestionVersions).where(inArray(schema.catalogQuestionVersions.id, qs.map((q) => q.question_version_id)));
    for (const r of rows) versions.set(r.id, questionContentSchema.parse(r.content));
    // Listening đúng hết, Reading đúng câu chẵn (theo vị trí), sai/trống câu lẻ
    const expected = { listening_p1: { marks: 0, max: 0 }, reading_p1: { marks: 0, max: 0 } } as Record<string, { marks: number; max: number }>;
    const answers = qs.map((q, i) => {
      const c = versions.get(q.question_version_id)!;
      const right = q.section_code === 'listening_p1' || i % 2 === 0;
      const answer = right ? keyAnswerOf(c)! : blankAnswer(c);
      const n = markCount(c);
      expected[q.section_code]!.max += n;
      expected[q.section_code]!.marks += Math.round((grade(c, answer).score ?? 0) * n);
      return { question_id: q.question_id, answer, time_spent_ms: 5000 };
    });
    expect((await learner.call('PUT', `/attempts/${a.body.id}/answers`, { answers })).status).toBe(204);
    const res = await learner.call('POST', `/attempts/${a.body.id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.by_section.listening_p1).toMatchObject({ marks: expected.listening_p1!.marks, max_marks: expected.listening_p1!.max });
    expect(res.body.by_section.reading_p1).toMatchObject({ marks: expected.reading_p1!.marks, max_marks: expected.reading_p1!.max });
    // TFNG 4 mệnh đề + "Choose TWO" + 4 chỗ trống… → nhiều câu hỏi hơn 18 câu catalog
    expect(expected.listening_p1!.max + expected.reading_p1!.max).toBeGreaterThan(18);
    const lBand = ieltsListeningBand(expected.listening_p1!.marks, expected.listening_p1!.max);
    // C3: Reading tra bảng riêng (Academic mặc định)
    const rBand = ieltsReadingBand(expected.reading_p1!.marks, expected.reading_p1!.max);
    expect(res.body.scale).toMatchObject({ program: 'ielts', unit: 'band', bands: { listening: lBand, reading: rBand } });
    expect(res.body.scaled).toBeNull();
    // C3: overall chỉ khi đủ 4 kỹ năng – đề mẫu L+R không có điểm tổng
    expect(res.body.scaled_score).toBeNull();
    expect(res.body.by_skill.reading).toMatchObject({ marks: expected.reading_p1!.marks, max_marks: expected.reading_p1!.max, scaled: rBand });

    const review = await learner.call('GET', `/attempts/${a.body.id}/review`);
    expect(review.status).toBe(200);
    const items = review.body.items as Array<{ question: PublicQ; is_correct: boolean | null; details: Record<string, boolean> | null; correct_answer: unknown }>;
    expect(items).toHaveLength(18);
    for (const it of items) {
      const c = versions.get(it.question.question_version_id)!;
      if (it.question.section_code === 'listening_p1') expect(it.is_correct, c.type).toBe(true);
      if (c.type !== 'mcq_single') expect(it.details, c.type).not.toBeNull();
    }
    const table = items.find((x) => x.question.content.type === 'table_completion')!;
    expect(Object.values(table.details ?? {}).every(Boolean)).toBe(true);
    expect(table.correct_answer).toEqual(expect.any(Object));
  });

  it('practice: feedback từng câu có details; giải thích AI nhận câu trả lời nhiều mục (cache theo câu trả lời)', async () => {
    const a = await learner.call('POST', '/attempts', { program: 'ielts', mode: 'practice', test_set_id: testSetId }, { 'idempotency-key': randomUUID() });
    expect(a.status).toBe(201);
    const qs = a.body.questions as PublicQ[];
    const q = qs.find((x) => x.content.type === 'form_completion')!;
    const c = versions.get(q.question_version_id) ?? questionContentSchema.parse((await dbs.db.select({ content: schema.catalogQuestionVersions.content }).from(schema.catalogQuestionVersions).where(eq(schema.catalogQuestionVersions.id, q.question_version_id)))[0]!.content);
    const key = keyAnswerOf(c) as { type: 'form_completion'; gaps: Record<string, string> };
    const [firstGap] = Object.keys(key.gaps);
    const mixed = { ...key, gaps: { ...key.gaps, [firstGap!]: 'definitely not this' } };
    expect((await learner.call('PUT', `/attempts/${a.body.id}/answers`, { answers: [{ question_id: q.question_id, answer: mixed, time_spent_ms: 3000 }] })).status).toBe(204);
    const st = await learner.call('GET', `/attempts/${a.body.id}`);
    const fb = st.body.feedback[q.question_id] as { is_correct: boolean; details: Record<string, boolean> };
    expect(fb.is_correct).toBe(false);
    expect(fb.details[firstGap!]).toBe(false);
    expect(Object.values(fb.details).filter(Boolean).length).toBe(Object.keys(key.gaps).length - 1);

    const e1 = await learner.call('POST', '/ai/explain', { question_version_id: q.question_version_id, answer: mixed });
    expect(e1.status).toBe(200);
    const e2 = await learner.call('POST', '/ai/explain', { question_version_id: q.question_version_id, answer: mixed });
    expect(e2.status).toBe(200);
    expect(String(e2.headers['content-type'])).toContain('application/json');
    expect(e2.body.cached).toBe(true);
    // Câu trả lời khác → khoá cache khác (không trả lời giải thích của người khác)
    // (giá trị ngẫu nhiên mỗi lần chạy – cache giải thích dùng chung, bền qua các lần chạy test trên cùng DB)
    const fresh = { ...key, gaps: { ...key.gaps, [firstGap!]: `khac-${uniq()}` } };
    const e3 = await learner.call('POST', '/ai/explain', { question_version_id: q.question_version_id, answer: fresh });
    expect(e3.status).toBe(200);
    expect(String(e3.headers['content-type'])).not.toContain('application/json');
    // Prompt gửi model có mục đánh số trong <user_input>, không có email người học
    const [task] = await dbs.db.select({ input: schema.aiAiTasks.inputRef }).from(schema.aiAiTasks).where(eq(schema.aiAiTasks.userId, learnerId)).limit(1);
    if (task?.input) expect(JSON.stringify(task.input)).not.toContain('@example.com');
  });
});
