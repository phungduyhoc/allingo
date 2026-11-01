import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { AttemptsService } from '../../src/modules/test-engine/index.js';
import { bootTestApp, client } from './setup.js';

/**
 * Sprint 3 – Test engine: practice hiện đáp án ngay (exam thì không), hết giờ (ân hạn 30 s → 409, job tự nộp),
 * nộp 2 lần cùng kết quả, chẩn đoán theo quy tắc, lọc review (sai/đánh dấu/Part), lọc lịch sử theo ngày/trạng thái.
 */
describe('test engine sprint 3 (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let api: ReturnType<typeof client>;
  let testSetId = '';

  // Mỗi test một khách mới (hạn mức Free: 3 đề mini/ngày/người)
  const newGuest = async () => {
    api = client(app);
    await api.call('POST', '/auth/guest', {});
  };

  beforeAll(async () => {
    app = await bootTestApp();
    dbs = app.get(DbService);
    await newGuest();
    const sets = await api.call('GET', '/programs/toeic/test-sets?kind=mini');
    testSetId = sets.body.data.find((t: { code: string }) => t.code === 'toeic-mini-part5-01').id;
  });
  afterAll(async () => {
    await app?.close();
  });

  const start = async (mode: 'exam' | 'practice') => {
    const r = await api.call('POST', '/attempts', { program: 'toeic', mode, test_set_id: testSetId }, { 'idempotency-key': crypto.randomUUID() });
    expect(r.status).toBe(201);
    return r.body as { id: string; questions: Array<{ question_id: string; section_code: string }>; feedback?: Record<string, { is_correct: boolean; correct_answer: unknown }> };
  };

  it('practice: sau khi lưu câu trả lời, GET attempt có feedback (đáp án + đúng/sai) chỉ cho câu đã làm; exam không có', async () => {
    const att = await start('practice');
    expect(att.feedback).toEqual({});
    const [q1, q2] = att.questions;
    await api.call('PUT', `/attempts/${att.id}/answers`, { answers: [{ question_id: q1!.question_id, answer: { type: 'mcq_single', selected: 'A' }, time_spent_ms: 3000 }] });
    const g = await api.call('GET', `/attempts/${att.id}`);
    expect(Object.keys(g.body.feedback)).toEqual([q1!.question_id]);
    expect(g.body.feedback[q1!.question_id]).toMatchObject({ is_correct: expect.any(Boolean), correct_answer: expect.stringMatching(/^[A-D]$/) });
    expect(g.body.feedback[q2!.question_id]).toBeUndefined();
    await api.call('POST', `/attempts/${att.id}/submit`);

    const exam = await start('exam');
    await api.call('PUT', `/attempts/${exam.id}/answers`, { answers: [{ question_id: exam.questions[0]!.question_id, answer: { type: 'mcq_single', selected: 'A' } }] });
    const ge = await api.call('GET', `/attempts/${exam.id}`);
    expect(ge.body.feedback).toBeUndefined();
    expect(JSON.stringify(ge.body)).not.toContain('answer_key');
    await api.call('POST', `/attempts/${exam.id}/submit`);
  });

  it('hết giờ: trong ân hạn 30 s vẫn lưu; quá hạn + 31 s → 409; job attempt.expire tự nộp, câu trống tính sai do hết giờ', async () => {
    await newGuest();
    const exam = await start('exam');
    const setExpiry = async (secondsAgo: number) =>
      dbs.db
        .update(schema.learnAttempts)
        .set({ draftState: sql`jsonb_set(${schema.learnAttempts.draftState}, '{expires_at}', to_jsonb((now() - make_interval(secs => ${secondsAgo}))::text))` })
        .where(eq(schema.learnAttempts.id, exam.id));
    const answer = (i: number) => ({ answers: [{ question_id: exam.questions[i]!.question_id, answer: { type: 'mcq_single', selected: 'B' } }] });
    await setExpiry(10);
    expect((await api.call('PUT', `/attempts/${exam.id}/answers`, answer(0))).status).toBe(204);
    await setExpiry(31);
    const late = await api.call('PUT', `/attempts/${exam.id}/answers`, answer(1));
    expect(late.status).toBe(409);

    const expired = await app.get(AttemptsService).expireOverdue();
    expect(expired).toBeGreaterThanOrEqual(1);
    const res = await api.call('GET', `/attempts/${exam.id}/result`);
    expect(res.status).toBe(200);
    expect(res.body.diagnosis.method).toBe('rules');
    expect(res.body.diagnosis.timeout_wrong).toBe(exam.questions.length - 1);
    expect(res.body.diagnosis.flags).toContain('time_pressure');
    // Nộp lại (client gọi khi hết giờ) trả cùng kết quả
    const again = await api.call('POST', `/attempts/${exam.id}/submit`);
    expect(again.status).toBe(200);
    expect(again.body.raw_score).toBe(res.body.raw_score);
  });

  it('review lọc câu sai / đánh dấu / theo Part; chẩn đoán có Part và kỹ năng yếu', async () => {
    await newGuest();
    const exam = await start('exam');
    const answers = exam.questions.map((q, i) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: i % 3 === 0 ? 'A' : 'D' }, time_spent_ms: 4000, flagged: i < 2 }));
    expect((await api.call('PUT', `/attempts/${exam.id}/answers`, { answers })).status).toBe(204);
    const submit = await api.call('POST', `/attempts/${exam.id}/submit`);
    expect(submit.body.diagnosis.method).toBe('rules');
    expect(submit.body.diagnosis.unanswered).toBe(0);

    const all = await api.call('GET', `/attempts/${exam.id}/review`);
    expect(all.body.items).toHaveLength(exam.questions.length);
    const wrong = await api.call('GET', `/attempts/${exam.id}/review?only_wrong=true`);
    expect(wrong.body.items.length).toBeGreaterThan(0);
    expect(wrong.body.items.every((i: { is_correct: boolean }) => i.is_correct === false)).toBe(true);
    const flagged = await api.call('GET', `/attempts/${exam.id}/review?flagged=true`);
    expect(flagged.body.items).toHaveLength(2);
    expect((await api.call('GET', `/attempts/${exam.id}/review?section=part7`)).body.items).toHaveLength(0);
    expect((await api.call('GET', `/attempts/${exam.id}/review?only_wrong=false&flagged=false`)).body.items).toHaveLength(exam.questions.length);
  });

  it('đề TOEIC Reading đầy đủ 01: 100 câu Part 5/6/7, đồng hồ 75 phút, Part 6–7 có đoạn văn theo nhóm; trả lời đúng hết → 495', async () => {
    await newGuest();
    const sets = await api.call('GET', '/programs/toeic/test-sets?kind=full');
    const full = sets.body.data.find((t: { code: string }) => t.code === 'toeic-reading-full-01');
    expect(full).toBeTruthy();
    const r = await api.call('POST', '/attempts', { program: 'toeic', mode: 'exam', test_set_id: full.id }, { 'idempotency-key': crypto.randomUUID() });
    expect(r.status).toBe(201);
    const att = r.body as {
      id: string;
      expires_at: string;
      server_time: string;
      sections: Array<{ section_code: string }>;
      questions: Array<{ question_id: string; question_version_id: string; section_code: string; group_key: string | null; passage: { id: string; body: string | null } | null; content: Record<string, unknown> }>;
    };
    expect(att.questions).toHaveLength(100);
    expect(att.sections.map((x) => x.section_code)).toEqual(['part5', 'part6', 'part7']);
    const minutes = (Date.parse(att.expires_at) - Date.parse(att.server_time)) / 60_000;
    expect(minutes).toBeGreaterThan(74);
    expect(minutes).toBeLessThanOrEqual(75);
    const count = (code: string) => att.questions.filter((q) => q.section_code === code).length;
    expect([count('part5'), count('part6'), count('part7')]).toEqual([30, 16, 54]);
    // Part 5 không đoạn văn; Part 6–7 mọi câu có đoạn văn, cùng group_key → cùng passage
    expect(att.questions.filter((q) => q.section_code === 'part5').every((q) => q.passage === null)).toBe(true);
    const grouped = att.questions.filter((q) => q.section_code !== 'part5');
    expect(grouped.every((q) => q.passage?.body && q.group_key)).toBe(true);
    const passageByGroup = new Map<string, string>();
    for (const q of grouped) {
      const prev = passageByGroup.get(q.group_key!);
      if (prev) expect(q.passage!.id).toBe(prev);
      else passageByGroup.set(q.group_key!, q.passage!.id);
    }
    expect(passageByGroup.size).toBe(19);
    expect(JSON.stringify(att.questions)).not.toContain('answer_key');

    // Đáp án đúng lấy từ DB (đúng phiên bản đã chốt trong attempt)
    const versions = await dbs.db
      .select({ id: schema.catalogQuestionVersions.id, content: schema.catalogQuestionVersions.content })
      .from(schema.catalogQuestionVersions)
      .where(inArray(schema.catalogQuestionVersions.id, att.questions.map((q) => q.question_version_id)));
    const correct = new Map(versions.map((v) => [v.id, (v.content as { answer_key: { correct: string } }).answer_key.correct]));
    const answers = att.questions.map((q) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: correct.get(q.question_version_id)! }, time_spent_ms: 20_000 }));
    for (let i = 0; i < answers.length; i += 50) {
      expect((await api.call('PUT', `/attempts/${att.id}/answers`, { answers: answers.slice(i, i + 50) })).status).toBe(204);
    }
    const res = await api.call('POST', `/attempts/${att.id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.raw_score).toBe(100);
    expect(res.body.scaled_score).toBe(495);
    expect(res.body.by_section).toMatchObject({ part5: { correct: 30, total: 30 }, part6: { correct: 16, total: 16 }, part7: { correct: 54, total: 54 } });
    expect(res.body.diagnosis.flags).toContain('strong_performance');
    expect(res.body.diagnosis.weak_sections).toEqual([]);
  });

  it('lịch sử lọc theo trạng thái và khoảng ngày', async () => {
    // cùng khách với test trước (1 bài đã chấm) + thêm 1 bài practice
    const p = await start('practice');
    await api.call('POST', `/attempts/${p.id}/submit`);
    const today = new Date().toISOString().slice(0, 10);
    const graded = await api.call('GET', `/me/attempts?status=graded&from=${today}&to=${today}`);
    expect(graded.status).toBe(200);
    expect(graded.body.data.length).toBe(2);
    expect(graded.body.data.every((a: { status: string }) => a.status === 'graded')).toBe(true);
    const past = await api.call('GET', '/me/attempts?to=2020-01-01');
    expect(past.body.data).toHaveLength(0);
  });
});
