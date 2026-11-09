import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { ieltsListeningBand, ieltsReadingBand } from '@allingo/scoring';
import { QUESTION_FIXTURES_ALL, grade, keyAnswerOf, markCount, questionContentSchema, type AnswerInput, type QuestionContent } from '@allingo/schemas';
import { DbService } from '../../src/shared/db/db.module.js';
import { bootTestApp, client } from './setup.js';

const PASSWORD = 'Allingo@2026';
const IELTS_FLAG = 'ff.catalog.program.ielts';
const uniq = () => Math.random().toString(36).slice(2, 8);

const fx = (type: keyof typeof QUESTION_FIXTURES_ALL): QuestionContent => QUESTION_FIXTURES_ALL[type][0]!.content;

/** TFNG n mệnh đề – đệm cho đủ số câu hỏi của section (nội dung thử tự viết) */
function tfng(n: number, tag: string): QuestionContent {
  const values = ['true', 'false', 'not_given'] as const;
  return questionContentSchema.parse({
    type: 'tfng',
    stem: `Do the following statements agree with the information in the text? (${tag})`,
    statements: Array.from({ length: n }, (_, i) => ({ key: String(i + 1), text: `${tag} – statement ${i + 1}` })),
    answer_key: { values: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), values[i % 3]])) },
  });
}

/** Đệm một section tới đúng `target` câu hỏi (mục) */
function fillTo(target: number, head: QuestionContent[], tag: string): QuestionContent[] {
  const used = head.reduce((t, c) => t + markCount(c), 0);
  if (used > target) throw new Error(`${tag}: ${used} > ${target}`);
  return used === target ? head : [...head, tfng(target - used, tag)];
}

/** Câu trả lời không đúng mục nào (trống) theo dạng */
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

interface PublicQ {
  question_id: string;
  question_version_id: string;
  section_code: string;
  number_start: number;
  mark_count: number;
  passage: { media_asset_id: string | null; media_url: string | null } | null;
  content: { type: string };
}

/**
 * C3 – IELTS Reading & Listening trên máy tính (integration, Postgres/Redis thật, AI mock). Nội dung thử dựng từ fixture dạng câu
 * (không phụ thuộc seed demo): Reading 3 passage 13/13/14 câu hỏi (General Training), Listening 4 part × 10 câu hỏi có audio part,
 * đề kết hợp L+R. Kiểm: đánh số 1–40 theo mục, band theo bảng riêng, Exam Mode khoá giải thích, đồng hồ theo kỹ năng + 409
 * `section_locked`, nghe một lần phía server (không cấp lại URL sau cửa sổ phát), transcript tô trích đoạn đáp án, sổ lỗi.
 */
describe('C3 – IELTS Reading & Listening (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let admin: ReturnType<typeof client>;
  let flagBefore: { enabled: boolean; rules: unknown } | null = null;
  const contents = new Map<string, QuestionContent>(); // question_id → nội dung có đáp án
  const ids = { reading: '', listening: '', combined: '' };
  const partAudio: string[] = [];
  let evidenceQuestionId = '';

  async function learner(): Promise<ReturnType<typeof client>> {
    const c = client(app);
    const r = await c.call('POST', '/auth/register', { email: `c3-${uniq()}@example.com`, password: 'Hoc-vien#C3-zQ8w', display_name: 'Learner C3', accept_terms: true });
    expect(r.status).toBe(201);
    return c;
  }

  beforeAll(async () => {
    process.env.JOBS_INLINE = 'true';
    process.env.CATALOG_CACHE_TTL_SECONDS = '0';
    app = await bootTestApp();
    dbs = app.get(DbService);
    admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    const f = await admin.call('GET', `/admin/flags/${IELTS_FLAG}`);
    if (f.status === 200) flagBefore = { enabled: !!f.body.enabled, rules: f.body.rules ?? {} };
    expect((await admin.call('PUT', `/admin/flags/${IELTS_FLAG}`, { enabled: true, rules: {} })).status).toBe(200);

    const db = dbs.db;
    const [adminRow] = await db.select({ id: schema.iamUsers.id }).from(schema.iamUsers).where(eq(schema.iamUsers.email, 'admin@allingo.dev'));
    const sections = await db.select({ id: schema.catalogSections.id, code: schema.catalogSections.code }).from(schema.catalogSections).where(eq(schema.catalogSections.programCode, 'ielts'));
    const sectionId = new Map(sections.map((s) => [s.code, s.id]));
    const tag = `c3it-${uniq()}`;

    const addQuestion = async (section: string, content: QuestionContent, passageId: string | null) => {
      const [q] = await db
        .insert(schema.catalogQuestions)
        .values({ programCode: 'ielts', sectionId: sectionId.get(section)!, questionTypeCode: content.type, passageId, status: 'published', source: 'human', difficultyTarget: 'B2', createdBy: adminRow!.id })
        .returning({ id: schema.catalogQuestions.id });
      const [v] = await db.insert(schema.catalogQuestionVersions).values({ questionId: q!.id, versionNo: 1, content, metadata: { test: tag }, createdBy: adminRow!.id }).returning({ id: schema.catalogQuestionVersions.id });
      await db.update(schema.catalogQuestions).set({ currentVersionId: v!.id }).where(eq(schema.catalogQuestions.id, q!.id));
      contents.set(q!.id, content);
      return q!.id;
    };
    const addPassage = async (kind: 'reading_passage' | 'audio_script', body: string, mediaAssetId: string | null = null) => {
      const [p] = await db.insert(schema.catalogPassages).values({ programCode: 'ielts', kind, title: `${tag} ${kind}`, body, mediaAssetId, status: 'published', source: 'human' }).returning({ id: schema.catalogPassages.id });
      return p!.id;
    };
    const addTestSet = async (code: string, level: string | null, durationSec: number, items: Array<{ id: string; section: string; group: string }>) => {
      const [ts] = await db.insert(schema.catalogTestSets).values({ programCode: 'ielts', code, title: { vi: code, en: code }, kind: 'full', isFree: true, durationSec, level, status: 'published', publishedAt: new Date() }).returning({ id: schema.catalogTestSets.id });
      const codes = [...new Set(items.map((i) => i.section))];
      await db.insert(schema.catalogTestSetSections).values(codes.map((c, i) => ({ testSetId: ts!.id, sectionId: sectionId.get(c)!, sortOrder: i + 1 })));
      await db.insert(schema.catalogTestSetItems).values(items.map((it, i) => ({ testSetId: ts!.id, questionId: it.id, sectionId: sectionId.get(it.section)!, sortOrder: i + 1, groupKey: it.group, points: '1' })));
      return ts!.id;
    };

    // Reading 13/13/14 – nhiều dạng C2 + TFNG đệm
    const readingPlan: Record<string, QuestionContent[]> = {
      reading_p1: fillTo(13, [fx('matching_headings'), fx('note_completion')], `${tag}-r1`),
      reading_p2: fillTo(13, [fx('summary_word_bank'), fx('sentence_completion')], `${tag}-r2`),
      reading_p3: fillTo(14, [fx('matching_information'), fx('short_answer'), fx('mcq_single')], `${tag}-r3`),
    };
    const readingItems: Array<{ id: string; section: string; group: string }> = [];
    for (const [section, list] of Object.entries(readingPlan)) {
      const passage = await addPassage('reading_passage', `${tag} passage for ${section}. Lorem ipsum.`);
      for (const c of list) readingItems.push({ id: await addQuestion(section, c, passage), section, group: `${tag}-${section}` });
    }

    // Listening 4 part × 10 – audio part có thời lượng + transcript segment
    const listeningItems: Array<{ id: string; section: string; group: string }> = [];
    for (const n of [1, 2, 3, 4]) {
      const section = `listening_p${n}`;
      const segments = [
        { start_ms: 0, end_ms: 5000, speaker: 'W1', text: 'Good morning, Riverside Sports Centre. How can I help?' },
        { start_ms: 5000, end_ms: 11000, speaker: 'M1', text: `Part ${n}: I'd like to book the badminton court for Thursday evening.` },
        { start_ms: 11000, end_ms: 16000, speaker: 'W1', text: 'Certainly. The court costs twelve pounds per hour.' },
      ];
      const [asset] = await db
        .insert(schema.catalogMediaAssets)
        .values({ kind: 'audio', externalUrl: `https://media.example.test/${tag}/part${n}.mp3`, mimeType: 'audio/mpeg', durationMs: 120_000, license: 'own', status: 'ready', transcript: segments, createdBy: adminRow!.id })
        .returning({ id: schema.catalogMediaAssets.id });
      partAudio.push(asset!.id);
      const passage = await addPassage('audio_script', segments.map((s) => s.text).join('\n'), asset!.id);
      const mcq = { ...(fx('mcq_single') as Extract<QuestionContent, { type: 'mcq_single' }>), evidence: 'The court costs twelve pounds per hour' };
      const list = fillTo(10, [fx('form_completion'), mcq], `${tag}-l${n}`);
      for (const c of list) {
        const id = await addQuestion(section, c, passage);
        if (n === 1 && c === mcq) evidenceQuestionId = id;
        listeningItems.push({ id, section, group: `${tag}-${section}` });
      }
    }
    ids.reading = await addTestSet(`${tag}-reading-gt`, 'general_training', 3600, readingItems);
    ids.listening = await addTestSet(`${tag}-listening`, null, 1800, listeningItems);
    ids.combined = await addTestSet(`${tag}-lr`, 'academic', 5400, [...listeningItems, ...readingItems]);
  });

  afterAll(async () => {
    if (admin) await admin.call('PUT', `/admin/flags/${IELTS_FLAG}`, flagBefore ?? { enabled: false, rules: {} });
    delete process.env.JOBS_INLINE;
    delete process.env.CATALOG_CACHE_TTL_SECONDS;
    await app?.close();
  });

  it('TestSetSummary.question_count của đề IELTS đếm theo mục (40), không theo số câu catalog', async () => {
    const me = await learner();
    for (const id of [ids.reading, ids.listening]) {
      const r = await me.call('GET', `/test-sets/${id}`);
      expect(r.status).toBe(200);
      expect(r.body.question_count).toBe(40);
    }
    const list = await me.call('GET', '/programs/ielts/test-sets?kind=full&limit=50');
    expect(list.status).toBe(200);
    const mine = (list.body.data as Array<{ id: string; question_count: number }>).filter((t) => t.id === ids.reading || t.id === ids.listening);
    expect(mine.map((t) => t.question_count)).toEqual([40, 40]);
  });

  it('Reading GT – đánh số 1–40 theo mục, đồng hồ 60′, Exam Mode khoá giải thích, chấm theo mục → band GT', async () => {
    const me = await learner();
    const a = await me.call('POST', '/attempts', { program: 'ielts', mode: 'exam', test_set_id: ids.reading }, { 'idempotency-key': randomUUID() });
    expect(a.status).toBe(201);
    const qs = a.body.questions as PublicQ[];
    // S167: số liên tục theo mục, câu đầu = 1, câu cuối kết thúc ở 40
    expect(qs[0]!.number_start).toBe(1);
    for (let i = 1; i < qs.length; i++) expect(qs[i]!.number_start).toBe(qs[i - 1]!.number_start + qs[i - 1]!.mark_count);
    expect(qs.at(-1)!.number_start + qs.at(-1)!.mark_count - 1).toBe(40);
    expect(a.body.exam_format).toMatchObject({ kind: 'ielts_cbt', module: 'general_training', listening_parts: [] });
    const secs = a.body.sections as Array<{ section_code: string; skill: string; ends_at: string | null; locked: boolean }>;
    expect(secs.map((s) => s.skill)).toEqual(['reading', 'reading', 'reading']);
    expect(Date.parse(secs[0]!.ends_at!) - Date.parse(a.body.started_at)).toBe(3600_000);
    expect(Math.round((Date.parse(a.body.expires_at) - Date.parse(a.body.started_at)) / 1000)).toBe(3600);

    // Exam Mode: giải thích AI bị khoá khi đang thi IELTS
    expect((await me.call('POST', '/ai/explain', { question_version_id: qs[0]!.question_version_id })).status).toBe(403);

    // Passage 1 đúng hết, passage 2–3: đúng câu chẵn
    let expected = 0;
    const answers = qs.map((q, i) => {
      const c = contents.get(q.question_id)!;
      const ans = q.section_code === 'reading_p1' || i % 2 === 0 ? keyAnswerOf(c)! : blankAnswer(c);
      expected += Math.round((grade(c, ans).score ?? 0) * markCount(c));
      return { question_id: q.question_id, answer: ans };
    });
    expect((await me.call('PUT', `/attempts/${a.body.id}/answers`, { answers })).status).toBe(204);
    const res = await me.call('POST', `/attempts/${a.body.id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.raw_score).toBe(expected);
    const band = ieltsReadingBand(expected, 40, 'general_training');
    expect(res.body.scale).toMatchObject({ unit: 'band', module: 'general_training', bands: { reading: band }, band: null, partial: true });
    expect(res.body.scaled_score).toBe(band);
    expect(res.body.by_skill.reading).toMatchObject({ marks: expected, max_marks: 40 });
    const tf = res.body.by_question_type.tfng as { marks: number; max_marks: number };
    expect(tf.max_marks).toBeGreaterThan(1);
    // Sau khi nộp: hết khoá Exam Mode; câu sai vào sổ lỗi theo chương trình IELTS
    // consumer attempt.graded chạy bất đồng bộ sau khi nộp → chờ tối đa 5 giây
    let entries: Array<{ error_kind?: string }> = [];
    for (let i = 0; i < 25 && entries.length === 0; i++) {
      const errors = await me.call('GET', '/me/errors?program=ielts');
      expect(errors.status).toBe(200);
      entries = errors.body.data as typeof entries;
      if (!entries.length) await new Promise((r) => setTimeout(r, 200));
    }
    expect(entries.length).toBeGreaterThan(0);
  });

  it('Listening – exam_format 4 part, nghe một lần phía server: hết cửa sổ phát thì không cấp lại URL (practice không áp dụng)', async () => {
    const me = await learner();
    const a = await me.call('POST', '/attempts', { program: 'ielts', mode: 'exam', test_set_id: ids.listening }, { 'idempotency-key': randomUUID() });
    expect(a.status).toBe(201);
    const fmt = a.body.exam_format as { module: string | null; preread_sec: number; review_sec: number; listening_parts: Array<{ section_code: string; media_asset_id: string; duration_ms: number; played: boolean; started_at: string | null }> };
    expect(fmt).toMatchObject({ module: null, preread_sec: 30, review_sec: 120 });
    expect(fmt.listening_parts.map((p) => p.media_asset_id)).toEqual(partAudio);
    expect(fmt.listening_parts.every((p) => p.duration_ms === 120_000 && !p.played && p.started_at === null)).toBe(true);
    // Đồng hồ Listening = 4 × (30 + 120) + 120 giây
    expect(Math.round((Date.parse(a.body.expires_at) - Date.parse(a.body.started_at)) / 1000)).toBe(4 * 150 + 120);

    expect((await me.call('POST', `/attempts/${a.body.id}/events`, { type: 'audio_started', meta: { asset_id: partAudio[0] } })).status).toBe(202);
    const again = await me.call('GET', `/attempts/${a.body.id}`);
    expect((again.body.exam_format.listening_parts[0].started_at as string | null)).not.toBeNull();
    expect(((await me.call('GET', `/attempts/${a.body.id}/media`)).body.data as Array<{ id: string }>).map((m) => m.id)).toContain(partAudio[0]);

    // Giả lập part 1 đã phát từ 5 phút trước (> 120 s + 60 s dung sai)
    const past = new Date(Date.now() - 5 * 60_000).toISOString();
    await dbs.db
      .update(schema.learnAttempts)
      .set({ draftState: sql`jsonb_set(draft_state, '{listen_started_at}', ${JSON.stringify({ [partAudio[0]!]: past })}::jsonb)` })
      .where(eq(schema.learnAttempts.id, a.body.id));
    const after = await me.call('GET', `/attempts/${a.body.id}`);
    expect(after.body.exam_format.listening_parts[0].played).toBe(true);
    expect(after.body.exam_format.listening_parts[1].played).toBe(false);
    const p1 = (after.body.questions as PublicQ[]).filter((q) => q.section_code === 'listening_p1');
    expect(p1.every((q) => q.passage?.media_url === null)).toBe(true);
    expect((after.body.questions as PublicQ[]).find((q) => q.section_code === 'listening_p2')!.passage?.media_url).toMatch(/part2\.mp3$/);
    const media = ((await me.call('GET', `/attempts/${a.body.id}/media`)).body.data as Array<{ id: string }>).map((m) => m.id);
    expect(media).not.toContain(partAudio[0]);
    expect(media).toContain(partAudio[1]);

    // Làm đúng hết → band Listening 9; Review: transcript tô segment chứa trích đoạn đáp án
    const answers = (after.body.questions as PublicQ[]).map((q) => ({ question_id: q.question_id, answer: keyAnswerOf(contents.get(q.question_id)!)! }));
    expect((await me.call('PUT', `/attempts/${a.body.id}/answers`, { answers })).status).toBe(204);
    const res = await me.call('POST', `/attempts/${a.body.id}/submit`);
    expect(res.body.scale.bands.listening).toBe(ieltsListeningBand(40));
    expect(res.body.scale.module).toBeNull();
    const review = await me.call('GET', `/attempts/${a.body.id}/review`);
    const item = (review.body.items as Array<{ question: PublicQ; transcript_highlight: { evidence_segments?: number[]; segments?: unknown[] } | null }>).find((x) => x.question.question_id === evidenceQuestionId)!;
    expect(item.transcript_highlight?.evidence_segments).toEqual([2]);
    expect(item.question.number_start).toBeGreaterThan(0);
    // Sau khi nộp: nghe lại được (Review)
    expect(((await me.call('GET', `/attempts/${a.body.id}/media`)).body.data as Array<{ id: string }>).map((m) => m.id)).toContain(partAudio[0]);

    // Practice: không ràng buộc nghe một lần
    const pr = await me.call('POST', '/attempts', { program: 'ielts', mode: 'practice', test_set_id: ids.listening }, { 'idempotency-key': randomUUID() });
    expect(pr.status).toBe(201);
    await dbs.db
      .update(schema.learnAttempts)
      .set({ draftState: sql`jsonb_set(draft_state, '{listen_started_at}', ${JSON.stringify({ [partAudio[0]!]: past })}::jsonb)` })
      .where(eq(schema.learnAttempts.id, pr.body.id));
    const prAgain = await me.call('GET', `/attempts/${pr.body.id}`);
    expect(prAgain.body.exam_format.listening_parts[0].played).toBe(false);
    expect((prAgain.body.questions as PublicQ[]).find((q) => q.section_code === 'listening_p1')!.passage?.media_url).toMatch(/part1\.mp3$/);
  });

  it('đề kết hợp L+R: chuyển sang Reading khoá Listening → lưu đáp án Listening 409 section_locked; Reading vẫn lưu', async () => {
    const me = await learner();
    const a = await me.call('POST', '/attempts', { program: 'ielts', mode: 'exam', test_set_id: ids.combined }, { 'idempotency-key': randomUUID() });
    expect(a.status).toBe(201);
    const qs = a.body.questions as PublicQ[];
    expect(qs.at(-1)!.number_start + qs.at(-1)!.mark_count - 1).toBe(80);
    const lq = qs.find((q) => q.section_code === 'listening_p2')!;
    const rq = qs.find((q) => q.section_code === 'reading_p1')!;
    const ans = (q: PublicQ) => ({ question_id: q.question_id, answer: keyAnswerOf(contents.get(q.question_id)!)! });
    expect((await me.call('PUT', `/attempts/${a.body.id}/answers`, { answers: [ans(lq)] })).status).toBe(204);
    // Hạn chung = Listening + Reading
    expect(Math.round((Date.parse(a.body.expires_at) - Date.parse(a.body.started_at)) / 1000)).toBe(4 * 150 + 120 + 3600);

    expect((await me.call('POST', `/attempts/${a.body.id}/events`, { type: 'part_switch', meta: { section_code: 'reading_p1' } })).status).toBe(202);
    const cur = await me.call('GET', `/attempts/${a.body.id}`);
    const secs = cur.body.sections as Array<{ section_code: string; skill: string; locked: boolean; ends_at: string }>;
    expect(secs.filter((s) => s.skill === 'listening').every((s) => s.locked)).toBe(true);
    expect(secs.filter((s) => s.skill === 'reading').every((s) => !s.locked)).toBe(true);
    const readingEnd = Date.parse(secs.find((s) => s.skill === 'reading')!.ends_at);
    expect(readingEnd).toBeLessThan(Date.parse(cur.body.expires_at));

    const locked = await me.call('PUT', `/attempts/${a.body.id}/answers`, { answers: [ans(lq)] });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatchObject({ code: 'conflict', details: { reason: 'section_locked', section_code: 'listening_p2' } });
    // Lô trộn: đáp án Reading được lưu, Listening bị bỏ
    const otherL = qs.find((q) => q.section_code === 'listening_p3')!;
    expect((await me.call('PUT', `/attempts/${a.body.id}/answers`, { answers: [ans(rq), ans(otherL)] })).status).toBe(204);
    const saved = await dbs.db
      .select({ q: schema.learnAttemptAnswers.questionId })
      .from(schema.learnAttemptAnswers)
      .where(and(eq(schema.learnAttemptAnswers.attemptId, a.body.id), sql`${schema.learnAttemptAnswers.answer} is not null`));
    const savedIds = new Set(saved.map((s) => s.q));
    expect(savedIds.has(rq.question_id)).toBe(true);
    expect(savedIds.has(otherL.question_id)).toBe(false);
    expect(savedIds.has(lq.question_id)).toBe(true);
    const res = await me.call('POST', `/attempts/${a.body.id}/submit`);
    expect(res.status).toBe(200);
    // L+R thiếu Writing/Speaking → không có overall
    expect(res.body.scaled_score).toBeNull();
    expect(res.body.scale).toMatchObject({ band: null, module: 'academic' });
  });
});
