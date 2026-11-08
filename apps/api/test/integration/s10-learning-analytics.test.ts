import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { toeic600ListId } from '@allingo/db/seed';
import { fromStored, newCardState, reviewCard, type SrsCardState, type SrsRating } from '@allingo/fsrs';
import { addDays, localDate, zonedDayStart } from '@allingo/planner';
import { correctAnswerOf, FEATURE_CODES } from '@allingo/schemas';
import { DbService } from '../../src/shared/db/db.module.js';
import { FakeClock, useClock } from '../../src/shared/clock/clock.module.js';
import { OutboxService } from '../../src/shared/events/outbox.service.js';
import { EntitlementService } from '../../src/modules/billing/index.js';
import { CatalogQueryService } from '../../src/modules/catalog/index.js';
import { ErrorLogService, SrsService } from '../../src/modules/learning/index.js';
import { ANALYTICS_SINK, FunnelService, StatsService, WeeklySummaryService, type MemoryAnalyticsSink } from '../../src/modules/analytics/index.js';
import { bootTestApp } from './setup.js';

/**
 * Sprint 10 – integration: SRS FSRS-5 (quota thẻ mới/ngày, Again trong phiên, Good ngày sau, idempotent, mô phỏng 7 ngày khớp
 * ts-fsrs), bộ từ TOEIC 600 + thêm cả bộ, sổ lỗi qua outbox attempt.graded (gộp, phân loại, drill từ đúng câu sai, đã hiểu →
 * khỏi review_errors), stats đầy đủ + cache/invalidate + p95, forecast v0, tóm tắt tuần, attribution, phễu PostHog (mock).
 */
describe('Sprint 10 – SRS, sổ lỗi, thống kê, phễu (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  const uniq = () => crypto.randomBytes(5).toString('hex');
  type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- body động trong test
  type Api = { id: string; token: string; call: (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown, headers?: Record<string, string>) => Promise<Res> };

  const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);
  const register = async (extra: Record<string, unknown> = {}): Promise<Api> => {
    const res = await inject({ method: 'POST', url: '/v1/auth/register', body: { email: `s10-${uniq()}@example.com`, password: 'Hoc-vien#S12-xK9q', display_name: 'Học viên S10', accept_terms: true, ...extra } });
    expect(res.statusCode).toBe(201);
    const b = res.json<{ access_token: string; user: { id: string } }>();
    return {
      id: b.user.id,
      token: b.access_token,
      call: async (method, url, body, headers = {}) => {
        const r = await inject({ method, url: `/v1${url}`, body: body as Record<string, unknown> | undefined, headers: { authorization: `Bearer ${b.access_token}`, ...headers } });
        let json: unknown = null;
        try {
          json = r.json();
        } catch {
          json = r.body;
        }
        return { status: r.statusCode, body: json as never };
      },
    };
  };
  const makePro = async (u: Api) => {
    await dbs.db.insert(schema.billingEntitlements).values(Object.values(FEATURE_CODES).map((f) => ({ userId: u.id, programCode: 'toeic', featureCode: f, source: 'admin', validFrom: new Date(Date.now() - 60_000), validTo: new Date(Date.now() + 60 * 86_400_000) })));
    await app.get(EntitlementService).invalidate(u.id);
  };
  const officeItems = async (n: number) => (await dbs.db.select({ id: schema.catalogVocabListItems.vocabItemId }).from(schema.catalogVocabListItems).where(eq(schema.catalogVocabListItems.listId, toeic600ListId('office'))).orderBy(schema.catalogVocabListItems.sortOrder).limit(n)).map((r) => r.id);
  const wrongAnswer = async (questionVersionId: string) => {
    const q = (await app.get(CatalogQueryService).loadByVersionIds([questionVersionId])).get(questionVersionId)!;
    const key = correctAnswerOf(q.content) as string;
    const letters = q.content.type === 'mcq_single' ? q.content.options.map((o) => o.key) : ['A', 'B', 'C', 'D'];
    return { right: { type: 'mcq_single', selected: key }, wrong: { type: 'mcq_single', selected: letters.find((l) => l !== key)! } };
  };

  beforeAll(async () => {
    process.env.JOBS_INLINE = 'true';
    process.env.EMAIL_PROVIDER = 'memory';
    app = await bootTestApp();
    dbs = app.get(DbService);
    await dbs.db.update(schema.billingFeatureFlags).set({ enabled: true }).where(eq(schema.billingFeatureFlags.key, 'ff.learning.study_plan'));
  });
  afterAll(async () => {
    delete process.env.EMAIL_PROVIDER;
    await app?.close();
  });

  // ------------------------------------------------------------------ SRS
  describe('SRS FSRS-5', () => {
    it('Free: thêm 20 từ (không 429) → hôm nay 10 thẻ mới; Again → quay lại trong phiên; Good → ≥ ngày mai; gửi lại idempotent; thẻ mới thứ 11 → 429', async () => {
      const t0 = new Date();
      const clock = new FakeClock(t0.getTime());
      const restore = useClock(clock);
      try {
        const u = await register();
        const ids = await officeItems(20);
        for (const id of ids) {
          const r = await u.call('POST', '/me/srs/cards', { program: 'toeic', card_type: 'vocab', ref_id: id, source_type: 'manual' });
          expect(r.status).toBe(201);
        }
        const due = (await u.call('GET', '/me/srs/due?program=toeic&limit=30')).body;
        expect(due.counts).toMatchObject({ new_total: 20, new_limit: 10, new_used_today: 0, new_remaining: 10, new_in_session: 10, due: 0 });
        expect(due.data).toHaveLength(10);
        expect(due.data[0].payload).toMatchObject({ headword: expect.any(String) });
        expect(due.data[0].preview.again).toBeDefined();
        const [a, g, ...rest] = due.data as Array<{ id: string; preview: { good: string } }>;
        const at = new Date(clock.now()).toISOString();
        const r1 = (await u.call('POST', '/me/srs/review', { reviews: [{ card_id: a!.id, rating: 1, reviewed_at: at }] })).body;
        expect(r1[0]).toMatchObject({ id: a!.id, state: 'learning', in_session: true, duplicate: false, reps: 1 });
        expect(new Date(r1[0].due_at).getTime() - clock.now()).toBeLessThanOrEqual(2 * 60_000);
        // Gửi lại cùng (card_id, reviewed_at) → không đổi lịch
        const dup = (await u.call('POST', '/me/srs/review', { reviews: [{ card_id: a!.id, rating: 3, reviewed_at: at }] })).body;
        expect(dup[0]).toMatchObject({ duplicate: true, reps: 1, state: 'learning' });
        const r2 = (await u.call('POST', '/me/srs/review', { reviews: [{ card_id: g!.id, rating: 3, reviewed_at: at }] })).body;
        expect(r2[0]).toMatchObject({ state: 'review', in_session: false });
        const tomorrow = zonedDayStart(addDays(localDate(clock.now(), 'Asia/Ho_Chi_Minh'), 1), 'Asia/Ho_Chi_Minh').getTime();
        expect(new Date(r2[0].due_at).getTime()).toBeGreaterThanOrEqual(tomorrow);
        expect(r2[0].due_at).toBe(g!.preview.good);
        // 8 thẻ mới còn lại trong 1 lô
        const batch = (await u.call('POST', '/me/srs/review', { reviews: rest.map((c) => ({ card_id: c.id, rating: 3 })) })).body;
        expect(batch).toHaveLength(8);
        const after = (await u.call('GET', '/me/srs/due?program=toeic')).body;
        expect(after.counts).toMatchObject({ new_used_today: 10, new_remaining: 0, new_in_session: 0 });
        expect(after.data).toHaveLength(0);
        // 2 phút sau: thẻ Again quay lại (learning)
        clock.advance(2 * 60_000);
        const back = (await u.call('GET', '/me/srs/due?program=toeic')).body;
        expect(back.data.map((c: { id: string }) => c.id)).toEqual([a!.id]);
        expect(back.data[0].state).toBe('learning');
        // Thẻ mới thứ 11 ôn trực tiếp → 429 (cả lô không ghi)
        const cards = (await u.call('GET', '/me/srs/cards?program=toeic&state=new&limit=5')).body;
        expect(cards.data.length).toBeGreaterThan(0);
        const over = await u.call('POST', '/me/srs/review', { reviews: [{ card_id: a!.id, rating: 3 }, { card_id: cards.data[0].id, rating: 3 }] });
        expect(over.status).toBe(429);
        expect(over.body.error.code).toBe('quota_exceeded');
        const [stillA] = await dbs.db.select().from(schema.learnSrsCards).where(eq(schema.learnSrsCards.id, a!.id));
        expect(stillA!.reps).toBe(1);
        // Ngày hôm sau (giờ VN): hạn mức mới 10
        clock.set(tomorrow + 3_600_000);
        const next = (await u.call('GET', '/me/srs/due?program=toeic&limit=30')).body;
        expect(next.counts).toMatchObject({ new_used_today: 0, new_remaining: 10, new_in_session: 10 });
        // XP srs_review + chuỗi ngày học
        const xp = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(schema.learnXpEvents).where(and(eq(schema.learnXpEvents.userId, u.id), eq(schema.learnXpEvents.kind, 'srs_review')));
        expect(xp[0]!.n).toBe(10);
      } finally {
        restore();
      }
    });

    it('mô phỏng 7 ngày: số thẻ đến hạn mỗi ngày và lịch từng thẻ khớp ts-fsrs (Pro 30 thẻ mới/ngày)', async () => {
      const day0 = zonedDayStart(addDays(localDate(Date.now(), 'Asia/Ho_Chi_Minh'), 1), 'Asia/Ho_Chi_Minh').getTime() + 2 * 3_600_000;
      const clock = new FakeClock(day0);
      const restore = useClock(clock);
      try {
        const u = await register();
        await makePro(u);
        const ids = await officeItems(12);
        for (const id of ids) expect((await u.call('POST', '/me/srs/cards', { program: 'toeic', card_type: 'vocab', ref_id: id })).status).toBe(201);
        // Mô hình tham chiếu: thẻ → trạng thái ts-fsrs (qua @allingo/fsrs, không qua DB)
        const ref = new Map<string, SrsCardState>();
        const rating = (cardIdx: number, day: number, rep: number): SrsRating => ([3, 1, 3, 4, 2, 3, 3] as const)[(cardIdx * 3 + day + rep) % 7]!;
        const order = new Map<string, number>();
        for (let day = 0; day < 7; day++) {
          clock.set(day0 + day * 86_400_000);
          // Lặp phiên tới khi không còn thẻ đến hạn trong ngày (thẻ Again quay lại sau 1/10 phút)
          for (let rep = 0; rep < 6; rep++) {
            const due = (await u.call('GET', '/me/srs/due?program=toeic&limit=100')).body;
            const now = clock.now();
            const expected = [...ref.entries()].filter(([, c]) => c.state !== 'new' && c.due_at.getTime() <= now).map(([id]) => id).sort();
            const got = due.data.filter((c: { state: string }) => c.state !== 'new').map((c: { id: string }) => c.id).sort();
            expect(got).toEqual(expected);
            if (!due.data.length) break;
            const reviews = due.data.map((c: { id: string }) => {
              if (!order.has(c.id)) order.set(c.id, order.size);
              return { card_id: c.id, rating: rating(order.get(c.id)!, day, rep), reviewed_at: new Date(now).toISOString() };
            });
            const out = (await u.call('POST', '/me/srs/review', { reviews })).body as Array<{ id: string; due_at: string; stability: number; difficulty: number; state: SrsCardState['state']; reps: number; lapses: number; last_review_at: string }>;
            for (const rv of reviews) {
              // Hàm chuyển trạng thái của API ≡ ts-fsrs (FSRS-5) trên đúng trạng thái đã lưu
              const prev = ref.get(rv.card_id) ?? newCardState(new Date(day0));
              const next = reviewCard(prev, rv.rating as SrsRating, new Date(now)).card;
              const o = out.find((x) => x.id === rv.card_id)!;
              expect(o.due_at).toBe(next.due_at.toISOString());
              expect(o.state).toBe(next.state);
              expect(o.reps).toBe(next.reps);
              expect(o.lapses).toBe(next.lapses);
              expect(o.stability).toBeCloseTo(next.stability!, 3);
              ref.set(rv.card_id, fromStored({ state: o.state, stability: o.stability, difficulty: o.difficulty, due_at: new Date(o.due_at), last_review_at: new Date(o.last_review_at), reps: o.reps, lapses: o.lapses }));
            }
            clock.advance(11 * 60_000);
          }
        }
        expect(ref.size).toBe(12);
        const reviews = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(schema.learnSrsReviews).innerJoin(schema.learnSrsCards, eq(schema.learnSrsCards.id, schema.learnSrsReviews.cardId)).where(eq(schema.learnSrsCards.userId, u.id));
        expect(reviews[0]!.n).toBeGreaterThan(12);
      } finally {
        restore();
      }
    });

    it('bộ từ TOEIC 600: 11 bộ (600 từ), thêm cả bộ idempotent, tiến độ theo bộ, items có srs; thẻ error/grammar; phoneme → 400', async () => {
      const u = await register();
      const lists = (await u.call('GET', '/vocab/lists?program=toeic')).body as Array<{ id: string; kind: string; counts: { total: number; enrolled: number }; next_action_code: string; topic: string | null }>;
      const all = lists.find((l) => l.id === toeic600ListId('all'))!;
      expect(all.counts.total).toBe(600);
      const topics = lists.filter((l) => l.kind === 'topic');
      expect(topics).toHaveLength(10);
      expect(topics.reduce((s, l) => s + l.counts.total, 0)).toBe(600);
      expect(topics.find((l) => l.id === toeic600ListId('office'))!.topic).toBe('office');
      expect(all.next_action_code).toBe('enroll');
      const e1 = (await u.call('POST', `/vocab/lists/${toeic600ListId('health')}/enroll`)).body;
      expect(e1).toMatchObject({ total: 30, added: 30, existing: 0, new_per_day: 10 });
      const e2 = (await u.call('POST', `/vocab/lists/${toeic600ListId('health')}/enroll`)).body;
      expect(e2).toMatchObject({ added: 0, existing: 30 });
      const after = (await u.call('GET', '/vocab/lists?program=toeic')).body as typeof lists;
      expect(after.find((l) => l.id === toeic600ListId('health'))).toMatchObject({ counts: { enrolled: 30, new: 30 }, next_action_code: 'learn_new', enrolled: true });
      const items = (await u.call('GET', `/vocab/lists/${toeic600ListId('health')}/items?limit=20`)).body;
      expect(items.data).toHaveLength(20);
      expect(items.data[0].srs).toMatchObject({ state: 'new' });
      expect(items.next_cursor).not.toBeNull();
      const page2 = (await u.call('GET', `/vocab/lists/${toeic600ListId('health')}/items?limit=20&cursor=${items.next_cursor}`)).body;
      expect(page2.data).toHaveLength(10);
      expect(new Set([...items.data, ...page2.data].map((x: { id: string }) => x.id)).size).toBe(30);
      // due theo bộ: thẻ mới học theo thứ tự trong bộ
      const due = (await u.call('GET', `/me/srs/due?program=toeic&list_id=${toeic600ListId('health')}`)).body;
      expect(due.data.map((c: { ref_id: string }) => c.ref_id)).toEqual(items.data.slice(0, 10).map((x: { id: string }) => x.id));
      expect((await u.call('POST', `/vocab/lists/${crypto.randomUUID()}/enroll`)).status).toBe(404);
      expect((await u.call('POST', '/me/srs/cards', { program: 'toeic', card_type: 'phoneme', ref_id: crypto.randomUUID() })).status).toBe(400);
      expect((await u.call('POST', '/me/srs/cards', { program: 'toeic', card_type: 'error', ref_id: crypto.randomUUID() })).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ sổ lỗi
  describe('sổ lỗi', () => {
    it('drill 10 câu sai 8 → 8 mục (loại theo luật, phiên bản đã làm), gộp khi chạy lại; drill từ đúng các câu; đã hiểu → khỏi review_errors; thẻ error; Exam Mode khoá', async () => {
      const u = await register();
      const r = (await u.call('GET', '/practice/questions?program=toeic&section=part5&count=10')).body;
      expect(r.questions).toHaveLength(10);
      const qs = r.questions as Array<{ question_id: string; question_version_id: string }>;
      const answers = [];
      for (let i = 0; i < qs.length; i++) {
        const w = await wrongAnswer(qs[i]!.question_version_id);
        answers.push({ question_id: qs[i]!.question_id, answer: i < 8 ? w.wrong : w.right, time_spent_ms: i === 0 ? 70_000 : 8_000 });
      }
      expect((await u.call('PUT', `/attempts/${r.id}/answers`, { answers })).status).toBe(204);
      expect((await u.call('POST', `/attempts/${r.id}/submit`)).status).toBe(200);
      const errorLog = app.get(ErrorLogService);
      await errorLog.ingest(r.id);
      await app.get(OutboxService).relayBatch(500);
      await errorLog.ingest(r.id);
      const page = (await u.call('GET', '/me/errors?program=toeic&limit=50')).body;
      expect(page.data).toHaveLength(8);
      expect(page.totals).toEqual({ open: 8, resolved: 0 });
      const wrongIds = qs.slice(0, 8).map((q) => q.question_id).sort();
      expect(page.data.map((e: { question_id: string }) => e.question_id).sort()).toEqual(wrongIds);
      for (const e of page.data) {
        expect(['paraphrase', 'trap', 'vocabulary', 'grammar', 'timeout', 'inference', 'listening_detail', 'other']).toContain(e.kind);
        expect(e).toMatchObject({ occurrences: 1, resolved: false, section_code: 'part5', attempt_id: r.id });
        expect(e.question_version_id).toBe(qs.find((q) => q.question_id === e.question_id)!.question_version_id);
        expect(e.question.content.answer_key).toBeUndefined();
        expect(e.correct_answer).toBeTruthy();
      }
      const slow = page.data.find((e: { question_id: string }) => e.question_id === qs[0]!.question_id);
      expect(slow).toMatchObject({ kind: 'timeout', reason_auto: { rule: 'slow' } });
      expect(Object.values(page.distribution as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(8);
      expect(page.by_section).toEqual({ part5: 8 });
      // lọc theo loại / Part / trạng thái
      expect((await u.call('GET', '/me/errors?program=toeic&kind=timeout')).body.data).toHaveLength(1);
      expect((await u.call('GET', '/me/errors?program=toeic&part=part7')).body.data).toHaveLength(0);
      // "Làm lại 10 câu sai" → timed_drill từ đúng 8 câu
      const drill = await u.call('POST', '/me/errors/drill', { program: 'toeic' });
      expect(drill.status).toBe(201);
      expect(drill.body.mode).toBe('timed_drill');
      expect(drill.body.questions.map((q: { question_id: string }) => q.question_id).sort()).toEqual(wrongIds);
      expect(drill.body.expires_at).not.toBeNull();
      // Lộ trình: task review_errors hôm nay (chèn vào tuần hiện tại) – đã hiểu hết → done
      const today = localDate(Date.now(), 'Asia/Ho_Chi_Minh');
      expect((await u.call('POST', '/me/plan', { program: 'toeic', target_score: 650, exam_date: addDays(today, 56), weekly_minutes: 300, study_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], reminder_time: '19:00', timezone: 'Asia/Ho_Chi_Minh' })).status).toBe(201);
      const plan = (await u.call('GET', '/me/plan?program=toeic')).body;
      const [task] = await dbs.db.insert(schema.learnPlanTasks).values({ planWeekId: plan.weeks[0].id, dueDate: today, taskType: 'review_errors', title: { vi: 'Ôn sổ lỗi', en: 'Review errors' }, estMinutes: 10, status: 'pending', evidence: { code: 'review_errors', params: { count: 10 } } }).returning();
      const t1 = (await u.call('GET', '/me/plan/today?program=toeic')).body;
      const re = t1.tasks.find((t: { id: string }) => t.id === task!.id);
      expect(re).toMatchObject({ errors_open: 8, launch: { kind: 'review_errors' } });
      const oldest = (await u.call('GET', '/me/errors?program=toeic&status=open&sort=oldest&limit=10')).body.data as Array<{ id: string }>;
      expect(oldest).toHaveLength(8);
      // PATCH: ghi chú + tạo thẻ + đã hiểu → biến mất khỏi danh sách review_errors
      const p1 = await u.call('PATCH', `/me/errors/${oldest[0]!.id}`, { note: 'Nhầm thì động từ', create_card: true, resolved: true });
      expect(p1.status).toBe(200);
      expect(p1.body).toMatchObject({ resolved: true, note: 'Nhầm thì động từ', srs_card_id: expect.any(String) });
      const open2 = (await u.call('GET', '/me/errors?program=toeic&status=open&sort=oldest&limit=10')).body.data as Array<{ id: string }>;
      expect(open2.map((e) => e.id)).not.toContain(oldest[0]!.id);
      expect(open2).toHaveLength(7);
      const card = (await u.call('GET', '/me/srs/due?program=toeic&card_type=error')).body;
      expect(card.data[0].payload).toMatchObject({ error_entry_id: oldest[0]!.id, note: 'Nhầm thì động từ' });
      expect(card.data[0].payload.correct_answer).toBeTruthy();
      for (const e of open2) await u.call('PATCH', `/me/errors/${e.id}`, { resolved: true });
      let doneStatus = 'pending';
      for (let i = 0; i < 40 && doneStatus !== 'done'; i++) {
        await new Promise((r) => setTimeout(r, 50));
        doneStatus = (await dbs.db.select().from(schema.learnPlanTasks).where(eq(schema.learnPlanTasks.id, task!.id)))[0]!.status;
      }
      expect(doneStatus).toBe('done');
      expect((await u.call('POST', '/me/errors/drill', { program: 'toeic' })).status).toBe(404);
      // Sai lại câu đã hiểu → mở lại, occurrences 2
      const d2 = drill.body as { id: string; questions: Array<{ question_id: string; question_version_id: string }> };
      const ans2 = [];
      for (const q of d2.questions) ans2.push({ question_id: q.question_id, answer: (await wrongAnswer(q.question_version_id)).wrong, time_spent_ms: 5_000 });
      await u.call('PUT', `/attempts/${d2.id}/answers`, { answers: ans2 });
      await u.call('POST', `/attempts/${d2.id}/submit`);
      await errorLog.ingest(d2.id);
      const reopened = (await u.call('GET', '/me/errors?program=toeic&status=open&limit=50')).body;
      expect(reopened.data).toHaveLength(8);
      expect(reopened.data.every((e: { occurrences: number }) => e.occurrences === 2)).toBe(true);
      // Exam Mode: sổ lỗi bị khoá, thẻ error loại khỏi phiên ôn
      const [full] = await dbs.db.select({ id: schema.catalogTestSets.id }).from(schema.catalogTestSets).where(eq(schema.catalogTestSets.code, 'toeic-reading-full-01'));
      const exam = await u.call('POST', '/attempts', { program: 'toeic', mode: 'exam', test_set_id: full!.id }, { 'idempotency-key': crypto.randomUUID() });
      expect(exam.status).toBe(201);
      const locked = await u.call('GET', '/me/errors?program=toeic');
      expect(locked.status).toBe(403);
      expect(locked.body.error.code).toBe('exam_mode_locked');
      expect((await u.call('GET', '/me/srs/due?program=toeic&card_type=error')).body.data).toHaveLength(0);
      await u.call('POST', `/attempts/${exam.body.id}/submit`);
    });
  });

  // ------------------------------------------------------------------ stats & forecast
  describe('thống kê & dự báo', () => {
    const seedAttempts = async (userId: string, n: number, opts: { from: number; to: number; base: number; slope: number }) => {
      const rows = Array.from({ length: n }, (_, i) => {
        const at = new Date(opts.from + ((opts.to - opts.from) * i) / Math.max(1, n - 1));
        const score = Math.round(opts.base + opts.slope * i);
        const c5 = 10 + (i % 10);
        return {
          userId,
          programCode: 'toeic',
          mode: i % 5 === 0 ? ('drill' as const) : ('exam' as const),
          status: 'graded' as const,
          startedAt: new Date(at.getTime() - 1_800_000),
          submittedAt: at,
          timeSpentSec: 1200,
          rawScore: String(c5),
          scaledScore: i % 5 === 0 ? null : String(score),
          scoreBreakdown: { by_section: { part5: { correct: c5, total: 30 }, part7: { correct: 20, total: 54 } }, by_question_type: { mcq_single: { correct: c5 + 20, total: 84 } }, by_subskill: { verb_tense: { correct: 3, total: 6 }, inference: { correct: i % 7, total: 8 } }, by_topic: {}, unanswered: 0, scale: {}, timeout_wrong: 0, scaled: { listening: Math.round(score / 2), reading: Math.round(score / 2) } } as never,
        };
      });
      await dbs.db.insert(schema.learnAttempts).values(rows);
    };

    it('GET /me/stats đầy đủ: lịch sử điểm, độ chính xác 30 ngày vs trước, phút/tuần, từ vựng, lỗi, percentile; cache 1 giờ + xoá khi attempt.graded; p95 < 300 ms (50 attempt)', async () => {
      const u = await register();
      await dbs.db.insert(schema.learnEnrollments).values({ userId: u.id, programCode: 'toeic', targetScore: '650' }).onConflictDoUpdate({ target: [schema.learnEnrollments.userId, schema.learnEnrollments.programCode], set: { targetScore: '650' } });
      const now = Date.now();
      await seedAttempts(u.id, 50, { from: now - 58 * 86_400_000, to: now - 3_600_000, base: 400, slope: 4 });
      // Cộng đồng cùng mục tiêu 600–695: 12 người có điểm ước tính
      for (let k = 0; k < 12; k++) {
        const peer = await register();
        await dbs.db.insert(schema.learnEnrollments).values({ userId: peer.id, programCode: 'toeic', targetScore: '600' }).onConflictDoUpdate({ target: [schema.learnEnrollments.userId, schema.learnEnrollments.programCode], set: { targetScore: '600' } });
        await seedAttempts(peer.id, 2, { from: now - 5 * 86_400_000, to: now - 86_400_000, base: 300 + k * 40, slope: 0 });
      }
      await app.get(StatsService).invalidate(u.id);
      const first = await u.call('GET', '/me/stats?program=toeic');
      expect(first.status).toBe(200);
      const s = first.body;
      expect(s.cached).toBe(false);
      expect(s.target).toBe(650);
      expect(s.score_history).toHaveLength(40);
      expect(s.score_history[0].score).toBeLessThan(s.score_history.at(-1).score);
      expect(s.current_estimate).toBe(s.score_history.at(-1).score);
      expect(s.accuracy.window_days).toBe(30);
      expect(s.accuracy.by_section.part5.current.total).toBeGreaterThan(0);
      expect(s.accuracy.by_section.part5.previous.total).toBeGreaterThan(0);
      expect(typeof s.accuracy.by_section.part5.delta).toBe('number');
      expect(s.accuracy.by_subskill.verb_tense.current.accuracy).toBe(50);
      expect(s.minutes_by_week).toHaveLength(8);
      expect(s.minutes_by_week.reduce((a: number, w: { minutes: number }) => a + w.minutes, 0)).toBeGreaterThan(0);
      expect(s.vocab).toMatchObject({ total: 0, mastered: 0 });
      expect(s.errors).toMatchObject({ open: 0, resolved: 0 });
      expect(s.community).toMatchObject({ reason: 'ok', target_bucket: '600-695' });
      expect(s.community.cohort_size).toBeGreaterThanOrEqual(13);
      expect(s.community.percentile).toBeGreaterThan(50);
      expect(s.streak).toBeDefined();
      expect(s.xp).toBeDefined();
      // Cache + p95
      const times: number[] = [];
      for (let i = 0; i < 30; i++) {
        const t = performance.now();
        const r = await u.call('GET', '/me/stats?program=toeic');
        times.push(performance.now() - t);
        expect(r.body.cached).toBe(true);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
      expect(p95).toBeLessThan(300);
      // Không cache: vẫn < 1 s
      await app.get(StatsService).invalidate(u.id);
      const t = performance.now();
      expect((await u.call('GET', '/me/stats?program=toeic')).body.cached).toBe(false);
      expect(performance.now() - t).toBeLessThan(1000);
      // attempt.graded (outbox) → xoá cache
      expect((await u.call('GET', '/me/stats?program=toeic')).body.cached).toBe(true);
      await app.get(StatsService).onOutboxGraded({ payload: { user_id: u.id, program: 'toeic' } });
      expect((await u.call('GET', '/me/stats?program=toeic')).body.cached).toBe(false);
      // ôn thẻ → xoá cache
      const card = (await u.call('POST', '/me/srs/cards', { program: 'toeic', card_type: 'vocab', ref_id: (await officeItems(1))[0] })).body;
      await u.call('POST', '/me/srs/review', { reviews: [{ card_id: card.id, rating: 3 }] });
      const afterReview = (await u.call('GET', '/me/stats?program=toeic')).body;
      expect(afterReview.cached).toBe(false);
      expect(afterReview.vocab).toMatchObject({ total: 1, learning: 1, reviews_7d: 1 });
    });

    it('GET /me/forecast v0: hồi quy tuyến tính, "ước tính sơ bộ", khoảng chứa dự báo, lưu score_forecasts 1 lần/ngày; chưa có điểm → insufficient_data', async () => {
      const empty = await register();
      const f0 = (await empty.call('GET', '/me/forecast?program=toeic')).body;
      expect(f0).toMatchObject({ status: 'insufficient_data', predicted_score: null, label: 'preliminary_estimate', recommendation_code: 'need_data', model_version: 'linreg-v0' });
      const u = await register();
      const today = localDate(Date.now(), 'Asia/Ho_Chi_Minh');
      await dbs.db.insert(schema.learnEnrollments).values({ userId: u.id, programCode: 'toeic', targetScore: '700', examDate: addDays(today, 60) }).onConflictDoUpdate({ target: [schema.learnEnrollments.userId, schema.learnEnrollments.programCode], set: { targetScore: '700', examDate: addDays(today, 60) } });
      await seedAttempts(u.id, 10, { from: Date.now() - 60 * 86_400_000, to: Date.now() - 86_400_000, base: 450, slope: 15 });
      const f = (await u.call('GET', '/me/forecast?program=toeic')).body;
      expect(f).toMatchObject({ status: 'ok', label: 'preliminary_estimate', target: 700, exam_date: addDays(today, 60), horizon_date: addDays(today, 60), scale: { min: 10, max: 990 } });
      expect(f.points_used).toBe(8);
      expect(f.slope_per_week).toBeGreaterThan(0);
      expect(f.ci_low).toBeLessThanOrEqual(f.predicted_score);
      expect(f.ci_high).toBeGreaterThanOrEqual(f.predicted_score);
      expect(f.predicted_score).toBeGreaterThan(f.current_estimate);
      expect(f.predicted_score).toBeLessThanOrEqual(990);
      await u.call('GET', '/me/forecast?program=toeic');
      const [enr] = await dbs.db.select().from(schema.learnEnrollments).where(and(eq(schema.learnEnrollments.userId, u.id), eq(schema.learnEnrollments.programCode, 'toeic')));
      const rows = await dbs.db.select().from(schema.learnScoreForecasts).where(eq(schema.learnScoreForecasts.enrollmentId, enr!.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.modelVersion).toBe('linreg-v0');
    });

    it('tóm tắt tuần thứ Hai: email + in-app cho người có hoạt động tuần trước (đồng ý marketing), không gửi trùng; không đồng ý → email bỏ qua', async () => {
      const yes = await register({ marketing_opt_in: true });
      const no = await register({ marketing_opt_in: false });
      const weekly = app.get(WeeklySummaryService);
      const monday = new Date(zonedDayStart(addDays(weekly.weekWindow(new Date()).weekStart, 7), 'Asia/Ho_Chi_Minh').getTime() + 9 * 3_600_000);
      const { from } = weekly.weekWindow(monday);
      for (const u of [yes, no]) await seedAttempts(u.id, 3, { from: from.getTime() + 86_400_000, to: from.getTime() + 3 * 86_400_000, base: 500, slope: 10 });
      const r = await weekly.run(monday, { userIds: [yes.id, no.id] });
      expect(r.candidates).toBe(2);
      const rows = await dbs.db.select().from(schema.opsNotifications).where(and(inArray(schema.opsNotifications.userId, [yes.id, no.id]), eq(schema.opsNotifications.templateCode, 'learning.weekly_summary')));
      const yesEmail = rows.find((x) => x.userId === yes.id && x.channel === 'email')!;
      expect(['sent', 'scheduled']).toContain(yesEmail.status);
      expect(rows.find((x) => x.userId === yes.id && x.channel === 'inapp')!.status).toBe('sent');
      expect(rows.find((x) => x.userId === no.id && x.channel === 'email')!.status).toBe('cancelled');
      const again = await weekly.run(monday, { userIds: [yes.id, no.id] });
      expect(again.candidates).toBe(0);
    });
  });

  // ------------------------------------------------------------------ attribution & phễu
  describe('attribution & phễu', () => {
    it('UTM/referrer lưu iam.users.attribution (host, path không query); outbox user.registered → signup_done (distinct_id băm, không PII); first_attempt; order_paid; client event cần đồng ý', async () => {
      const sink = app.get<MemoryAnalyticsSink>(ANALYTICS_SINK);
      sink.clear();
      const email = `s10-attr-${uniq()}@example.com`;
      const res = await inject({ method: 'POST', url: '/v1/auth/register', body: { email, password: 'Hoc-vien#S12-xK9q', display_name: 'Attr', accept_terms: true, attribution: { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'beta-toeic', referrer: 'https://www.google.com/search?q=toeic+ai', landing_path: '/toeic?utm_source=facebook&gclid=abc', first_seen_at: new Date(Date.now() - 3_600_000).toISOString() } } });
      expect(res.statusCode).toBe(201);
      const userId = res.json<{ user: { id: string } }>().user.id;
      const [row] = await dbs.db.select({ a: schema.iamUsers.attribution }).from(schema.iamUsers).where(eq(schema.iamUsers.id, userId));
      expect(row!.a).toMatchObject({ utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'beta-toeic', referrer_host: 'www.google.com', landing_path: '/toeic', channel: 'cpc' });
      expect(JSON.stringify(row!.a)).not.toContain('q=toeic');
      await app.get(OutboxService).relayBatch(1000);
      const funnel = app.get(FunnelService);
      const signup = sink.events.find((e) => e.event === 'signup_done' && e.distinct_id === funnel.distinctId(userId));
      expect(signup).toBeDefined();
      expect(signup!.properties).toMatchObject({ channel: 'cpc', utm_source: 'facebook', source: 'server' });
      expect(signup!.distinct_id).not.toContain(userId);
      // Dữ liệu gửi ra ngoài (PostHog nhận event/distinct_id/properties/timestamp + uuid băm từ dedupe_key) không chứa PII/user id
      const outbound = JSON.stringify(sink.events.map((e) => ({ event: e.event, distinct_id: e.distinct_id, properties: e.properties, timestamp: e.timestamp })));
      expect(outbound).not.toContain(email);
      expect(outbound).not.toContain(userId);
      // first_attempt (bài chấm đầu tiên) – chỉ một lần
      const token = res.json<{ access_token: string }>().access_token;
      const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => inject({ method, url: `/v1${url}`, body: body as never, headers: { authorization: `Bearer ${token}` } }).then((r) => r.json<any>()); // eslint-disable-line @typescript-eslint/no-explicit-any -- body động
      const a = await call('GET', '/practice/questions?program=toeic&section=part5&count=3');
      await call('POST', `/attempts/${a.id}/submit`);
      const b = await call('GET', '/practice/questions?program=toeic&section=part5&count=3');
      await call('POST', `/attempts/${b.id}/submit`);
      await app.get(OutboxService).relayBatch(1000);
      await app.get(OutboxService).relayBatch(1000);
      expect(sink.events.filter((e) => e.event === 'first_attempt' && e.distinct_id === funnel.distinctId(userId))).toHaveLength(1);
      // order_paid (payload outbox) – idempotent theo order_id
      const orderId = crypto.randomUUID();
      const ev = { payload: { order_id: orderId, user_id: userId, plan_code: 'toeic_pro_monthly', plan_kind: 'monthly', total: 199000, currency: 'VND', provider: 'mock', promotion_code: null } };
      await funnel.onPaid(ev);
      await funnel.onPaid(ev);
      const paid = sink.events.filter((e) => e.event === 'order_paid' && e.dedupe_key === `order_paid:${orderId}`);
      expect(paid).toHaveLength(1);
      expect(paid[0]!.properties).toMatchObject({ revenue: 199000, plan_kind: 'monthly' });
      // Client: không đồng ý → không nhận; đồng ý → landing_view (anonymous_id), email trong thuộc tính bị bỏ
      const noConsent = await inject({ method: 'POST', url: '/v1/analytics/events', body: { event: 'landing_view', anonymous_id: 'anon_12345678', consent: false } });
      expect(noConsent.statusCode).toBe(202);
      expect(noConsent.json()).toEqual({ accepted: false, reason: 'no_consent' });
      const ok = await inject({ method: 'POST', url: '/v1/analytics/events', body: { event: 'landing_view', anonymous_id: 'anon_12345678', consent: true, path: '/toeic?utm_source=x', properties: { program: 'toeic', contact: 'a@b.co' } } });
      expect(ok.json()).toEqual({ accepted: true, reason: 'ok' });
      const lv = sink.events.find((e) => e.event === 'landing_view')!;
      expect(lv).toMatchObject({ distinct_id: 'anon_12345678', properties: { program: 'toeic', path: '/toeic', source: 'client_relay' } });
      expect(lv.properties.contact).toBeUndefined();
      expect((await inject({ method: 'POST', url: '/v1/analytics/events', body: { event: 'order_paid', anonymous_id: 'anon_12345678', consent: true } })).statusCode).toBe(400);
    });
  });

  it('job srs.optimize: ≥ 1.000 review → lưu fsrs_params (model fsrs-5) và dùng cho lịch', async () => {
    const u = await register();
    const items = (await dbs.db.select({ id: schema.catalogVocabListItems.vocabItemId }).from(schema.catalogVocabListItems).where(eq(schema.catalogVocabListItems.listId, toeic600ListId('all'))).limit(220)).map((r) => r.id);
    const cards = await dbs.db.insert(schema.learnSrsCards).values(items.map((refId) => ({ userId: u.id, programCode: 'toeic', cardType: 'vocab' as const, refId, state: 'review' as const, stability: 3, difficulty: 5, dueAt: new Date() }))).returning({ id: schema.learnSrsCards.id });
    // Người học quên nhanh: ôn 5 lần/thẻ, quên nhiều khi cách ≥ 3 ngày
    const start = Date.now() - 200 * 86_400_000;
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const rows = cards.flatMap((c, i) => {
      let t = start + i * 60_000;
      return Array.from({ length: 5 }, (_, k) => {
        const gap = [0, 1, 3, 6, 10][k]!;
        t += gap * 86_400_000;
        const rating = k === 0 ? 3 : rnd() < (gap >= 3 ? 0.55 : 0.85) ? 3 : 1;
        return { cardId: c.id, rating, reviewMode: 'flashcard', reviewedAt: new Date(t) };
      });
    });
    await dbs.db.insert(schema.learnSrsReviews).values(rows);
    const srs = app.get(SrsService);
    const cands = await srs.optimizationCandidates(new Date());
    expect(cands.some((c) => c.userId === u.id && c.reviews === 1100)).toBe(true);
    const r = await srs.optimizeUser(u.id, 'toeic');
    expect(r).toMatchObject({ reviews: 1100 });
    const [enr] = await dbs.db.select().from(schema.learnEnrollments).where(and(eq(schema.learnEnrollments.userId, u.id), eq(schema.learnEnrollments.programCode, 'toeic')));
    expect(enr!.fsrsParams).toMatchObject({ model: 'fsrs-5', review_count: 1100, optimizer: 'allingo-cd-v1' });
    expect((await srs.optimizationCandidates(new Date())).some((c) => c.userId === u.id)).toBe(false);
  });
});
