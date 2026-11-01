import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { bootTestApp, client } from './setup.js';

type Q = { question_id: string; group_key: string | null; content: { media?: { audio_asset_id?: string; pause_ms?: number } }; passage: { id: string; media_asset_id?: string | null } | null };

/**
 * v1.1 – Sprint 5 (yêu cầu từ web S4): timed_drill Listening cộng audio + pause (audio nhóm Part 3/4 một lần mỗi nhóm);
 * ui_state.listening {step, offset_ms} lưu qua PUT /answers và trả lại ở GET /attempts/{id}.
 */
describe('test-engine S5: timed_drill Listening + ui_state.listening (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  const saved = new Map<string, number | null>();
  const QUESTION_AUDIO_MS = 4_500;
  const GROUP_AUDIO_MS = 30_000;

  /** Đặt thời lượng cho mọi audio của câu/passage đã phát hành trong section (lưu lại để khôi phục) */
  const setDurations = async (section: string, questionMs: number, groupMs: number) => {
    const rows = await dbs.db.execute<{ qa: string | null; pa: string | null }>(sql`
      select (v.content -> 'media' ->> 'audio_asset_id') as qa, p.media_asset_id::text as pa
        from catalog.questions q
        join catalog.question_versions v on v.id = q.current_version_id
        join catalog.sections s on s.id = q.section_id
        left join catalog.passages p on p.id = q.passage_id
       where s.code = ${section} and q.status = 'published' and q.program_code = 'toeic'`);
    const qa = [...new Set([...rows].map((r) => r.qa).filter((x): x is string => !!x))];
    const pa = [...new Set([...rows].map((r) => r.pa).filter((x): x is string => !!x))];
    const all = [...qa, ...pa];
    if (all.length) {
      for (const r of await dbs.db.select({ id: schema.catalogMediaAssets.id, d: schema.catalogMediaAssets.durationMs }).from(schema.catalogMediaAssets).where(inArray(schema.catalogMediaAssets.id, all))) if (!saved.has(r.id)) saved.set(r.id, r.d ?? null);
    }
    if (qa.length) await dbs.db.update(schema.catalogMediaAssets).set({ durationMs: questionMs }).where(inArray(schema.catalogMediaAssets.id, qa));
    if (pa.length) await dbs.db.update(schema.catalogMediaAssets).set({ durationMs: groupMs }).where(inArray(schema.catalogMediaAssets.id, pa));
  };

  /** Kỳ vọng độc lập với dữ liệu: Σ (trả lời + audio câu + pause) + audio nhóm một lần */
  const expected = (qs: Q[], answerSec: number) => {
    let ms = 0;
    const groups = new Set<string>();
    for (const q of qs) {
      ms += answerSec * 1000;
      const hasAudio = !!q.content.media?.audio_asset_id;
      const group = q.passage?.media_asset_id ?? null;
      if (hasAudio) ms += QUESTION_AUDIO_MS;
      if (hasAudio || group) ms += q.content.media?.pause_ms ?? 0;
      if (group && !groups.has(q.group_key ?? q.passage!.id)) {
        groups.add(q.group_key ?? q.passage!.id);
        ms += GROUP_AUDIO_MS;
      }
    }
    return Math.ceil(ms / 1000);
  };
  const limitOf = async (attemptId: string) => {
    const [row] = await dbs.db.select({ d: schema.learnAttempts.draftState }).from(schema.learnAttempts).where(eq(schema.learnAttempts.id, attemptId));
    return (row!.d as { time_limit_sec: number }).time_limit_sec;
  };

  beforeAll(async () => {
    app = await bootTestApp();
    dbs = app.get(DbService);
    await setDurations('part1', QUESTION_AUDIO_MS, GROUP_AUDIO_MS);
    await setDurations('part3', QUESTION_AUDIO_MS, GROUP_AUDIO_MS);
  });

  afterAll(async () => {
    for (const [id, d] of saved) await dbs.db.update(schema.catalogMediaAssets).set({ durationMs: d }).where(eq(schema.catalogMediaAssets.id, id));
    await app?.close();
  });

  it('Part 1: 6 câu → hạn = 6 × (20 s trả lời + audio + pause 5 s), không còn 120 s; per_question_sec chỉ thay phần trả lời', async () => {
    const api = client(app);
    await api.call('POST', '/auth/guest', {});
    const r = await api.call('GET', '/practice/questions?program=toeic&section=part1&count=6&timed=true');
    expect(r.status).toBe(201);
    const qs = r.body.questions as Q[];
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.every((q) => !!q.content.media?.audio_asset_id)).toBe(true);
    const limit = await limitOf(r.body.id);
    expect(limit).toBe(expected(qs, 20));
    expect(limit).toBeGreaterThan(qs.length * 20);
    if (qs.length === 6) expect(limit).toBe(6 * 20 + Math.ceil(6 * (QUESTION_AUDIO_MS + 5_000) / 1000));
    const secs = (Date.parse(r.body.expires_at) - Date.parse(r.body.server_time)) / 1000;
    expect(Math.abs(secs - limit)).toBeLessThanOrEqual(2);
    const o = await api.call('GET', '/practice/questions?program=toeic&section=part1&count=6&timed=true&per_question_sec=10');
    expect(await limitOf(o.body.id)).toBe(expected(o.body.questions as Q[], 10));
  });

  it('Part 3: audio hội thoại (passage) tính một lần mỗi nhóm + audio/pause từng câu', async () => {
    const api = client(app);
    await api.call('POST', '/auth/guest', {});
    const r = await api.call('GET', '/practice/questions?program=toeic&section=part3&count=6&timed=true');
    expect(r.status).toBe(201);
    const qs = r.body.questions as Q[];
    const groups = new Set(qs.filter((q) => q.passage?.media_asset_id).map((q) => q.group_key));
    expect(groups.size).toBeGreaterThanOrEqual(1);
    const limit = await limitOf(r.body.id);
    expect(limit).toBe(expected(qs, 35));
    // Nhóm không bị tính lặp theo số câu
    expect(limit).toBeLessThan(qs.length * (35 + GROUP_AUDIO_MS / 1000));
  });

  it('ui_state.listening {step, offset_ms}: PUT lưu, GET trả lại; gộp nông với current_question_id; giá trị âm → 400', async () => {
    const api = client(app);
    await api.call('POST', '/auth/guest', {});
    const a = await api.call('GET', '/practice/questions?program=toeic&section=part3&count=3');
    expect(a.status).toBe(201);
    const id = a.body.id as string;
    expect((await api.call('PUT', `/attempts/${id}/answers`, { answers: [], ui_state: { current_section_code: 'part3', listening: { step: 3, offset_ms: 12_500 } } })).status).toBe(204);
    const g1 = await api.call('GET', `/attempts/${id}`);
    expect(g1.body.ui_state).toMatchObject({ current_section_code: 'part3', listening: { step: 3, offset_ms: 12_500 } });
    expect((await api.call('PUT', `/attempts/${id}/answers`, { answers: [], ui_state: { current_question_id: a.body.questions[1].question_id } })).status).toBe(204);
    const g2 = await api.call('GET', `/attempts/${id}`);
    expect(g2.body.ui_state).toMatchObject({ current_question_id: a.body.questions[1].question_id, listening: { step: 3, offset_ms: 12_500 } });
    expect((await api.call('PUT', `/attempts/${id}/answers`, { answers: [], ui_state: { listening: { step: 4, offset_ms: 0 } } })).status).toBe(204);
    expect((await api.call('GET', `/attempts/${id}`)).body.ui_state.listening).toEqual({ step: 4, offset_ms: 0 });
    expect((await api.call('PUT', `/attempts/${id}/answers`, { answers: [], ui_state: { listening: { step: -1, offset_ms: 0 } } })).status).toBe(400);
    expect((await api.call('PUT', `/attempts/${id}/answers`, { answers: [], ui_state: { listening: { step: 1 } } })).status).toBe(400);
    const [row] = await dbs.db.select({ d: schema.learnAttempts.draftState }).from(schema.learnAttempts).where(and(eq(schema.learnAttempts.id, id)));
    expect((row!.d as { ui_state: unknown }).ui_state).toMatchObject({ listening: { step: 4, offset_ms: 0 } });
  });
});
