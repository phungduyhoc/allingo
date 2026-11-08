import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { StorageService } from '../../src/shared/storage/storage.module.js';
import { MediaAssetsService, MediaProcessorService } from '../../src/modules/speech/index.js';
import { bootTestApp, client } from './setup.js';

const PASSWORD = 'Allingo@2026';
const INTERNAL = { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token' };
const TOPIC = 's4-fixture-talks';
const { catalogMediaAssets, catalogPassages, catalogQuestions, catalogQuestionVersions, catalogSections, catalogTestSets, catalogTestSetItems, catalogTestSetSections, catalogTopics } = schema;

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><title>Part 1 – office</title><rect width="320" height="240" fill="#eef"/><circle cx="160" cy="120" r="40" fill="url(#g)"/><defs><linearGradient id="g"><stop offset="0" stop-color="#336"/></linearGradient></defs></svg>`;

/**
 * Sprint 4 – Listening & practice: không lộ transcript khi đang làm (passage audio_script, chữ Part 1/2), Review trả transcript;
 * URL media gia hạn (GET /attempts/{id}/media); SVG Part 1; timed_drill theo Part; nguồn câu luyện ưu tiên chưa làm → sai gần đây,
 * giữ trọn nhóm; điểm L&R + khoảng ước tính; sự kiện audio → audio_plays; mini test generator (admin) lặp lại theo seed.
 * Fixture Listening tạo trực tiếp trong catalog (idempotent theo metadata.seed_key) – không dùng seed demo Listening.
 */
describe('test engine sprint 4 (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allingo-s4-storage-'));
  const fx = {
    svgId: '',
    p1Audio: [] as string[],
    p3Audio: '',
    p1: [] as string[],
    p3: [] as string[],
    p3Passage: '',
    p4Groups: [] as string[][],
    reading: [] as string[],
    testSetId: '',
  };

  const guest = async () => {
    const api = client(app);
    expect((await api.call('POST', '/auth/guest', {})).status).toBeLessThan(300);
    return api;
  };

  beforeAll(async () => {
    // Không phụ thuộc .env cục bộ (CI không có .env): job chạy inline; tắt cache câu 30 s (S11) vì test đọc thống kê cộng đồng
    // (community_avg_time_ms) ngay sau khi nộp – trên máy CI nhanh, bản cache lúc làm bài (avg = null) còn hạn
    process.env.JOBS_INLINE = 'true';
    process.env.CATALOG_CACHE_TTL_SECONDS = '0';
    process.env.STORAGE_DRIVER = '';
    process.env.STORAGE_FS_DIR = storageDir;
    process.env.SEARCH_PROVIDER = 'pg';
    app = await bootTestApp();
    dbs = app.get(DbService);
    const db = dbs.db;
    const storage = app.get(StorageService);
    const media = app.get(MediaAssetsService);

    const sections = new Map((await db.select({ id: catalogSections.id, code: catalogSections.code }).from(catalogSections).where(eq(catalogSections.programCode, 'toeic'))).map((r) => [r.code, r.id]));
    const [topic] = await db
      .insert(catalogTopics)
      .values({ programCode: 'toeic', code: TOPIC, name: { vi: 'S4 fixture', en: 'S4 fixture' } })
      .onConflictDoUpdate({ target: [catalogTopics.programCode, catalogTopics.code], set: { name: sql`excluded.name` } })
      .returning({ id: catalogTopics.id });

    // Ảnh SVG Part 1 qua helper seed/script (xử lý đồng bộ, không cần ffmpeg)
    const svg = await media.createContentAsset({ kind: 'image', mimeType: 'image/svg+xml', body: Buffer.from(SVG.replace('office', `office ${Date.now()}`)) });
    expect(svg.status).toBe('ready');
    fx.svgId = svg.mediaAssetId;

    const audio = async (name: string, transcript: unknown) => {
      const key = `s4-fixture/${name}.mp3`;
      await storage.putObject('media', key, Buffer.from('ID3-fake-mp3'), { contentType: 'audio/mpeg' });
      const [existing] = await db.select({ id: catalogMediaAssets.id }).from(catalogMediaAssets).where(eq(catalogMediaAssets.storageKey, key)).limit(1);
      if (existing) {
        await db.update(catalogMediaAssets).set({ transcript, status: 'ready' }).where(eq(catalogMediaAssets.id, existing.id));
        return existing.id;
      }
      const [row] = await db.insert(catalogMediaAssets).values({ kind: 'audio', storageKey: key, mimeType: 'audio/mpeg', durationMs: 4000, status: 'ready', transcript, metadata: { bucket: 'media', origin: 'tts' } }).returning({ id: catalogMediaAssets.id });
      return row!.id;
    };
    fx.p1Audio = [
      await audio('p1a', [
        { start_ms: 0, end_ms: 2000, text: '(A) ZEBRA-P1A-AUDIO The woman is reading.', speaker: 'M' },
        { start_ms: 2000, end_ms: 4000, text: '(B) The woman is typing.', speaker: 'M' },
      ]),
      await audio('p1b', { text: 'ZEBRA-P1B-AUDIO (A) A man is cooking.' }),
    ];
    fx.p3Audio = await audio('p3', [
      { start_ms: 0, end_ms: 3000, text: 'W: ZEBRA-P3-SCRIPT Hi, I am calling about the order.', speaker: 'W' },
      { start_ms: 3000, end_ms: 6000, text: 'M: It ships tomorrow.', speaker: 'M' },
    ]);

    const passage = async (key: string, body: string, mediaId: string | null) => {
      const [q] = await db.select({ passageId: catalogQuestions.passageId }).from(catalogQuestionVersions).innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId)).where(sql`${catalogQuestionVersions.metadata} ->> 'seed_key' = ${`${key}-1`}`).limit(1);
      const values = { programCode: 'toeic', kind: 'audio_script' as const, title: `Conversation ${key}`, body, mediaAssetId: mediaId, status: 'published' as const, source: 'human' as const };
      if (q?.passageId) {
        await db.update(catalogPassages).set(values).where(eq(catalogPassages.id, q.passageId));
        return q.passageId;
      }
      const [row] = await db.insert(catalogPassages).values(values).returning({ id: catalogPassages.id });
      return row!.id;
    };
    const question = async (key: string, section: string, content: Record<string, unknown>, opts: { passageId?: string | null; topicId?: string | null; number?: number } = {}) => {
      const [existing] = await db.select({ qid: catalogQuestionVersions.questionId, vid: catalogQuestionVersions.id }).from(catalogQuestionVersions).where(sql`${catalogQuestionVersions.metadata} ->> 'seed_key' = ${key}`).limit(1);
      if (existing) {
        await db.update(catalogQuestionVersions).set({ content: content as never }).where(eq(catalogQuestionVersions.id, existing.vid));
        await db.update(catalogQuestions).set({ passageId: opts.passageId ?? null, topicId: opts.topicId ?? null, status: 'published' }).where(eq(catalogQuestions.id, existing.qid));
        return existing.qid;
      }
      const [q] = await db.insert(catalogQuestions).values({ programCode: 'toeic', sectionId: sections.get(section)!, questionTypeCode: 'mcq_single', passageId: opts.passageId ?? null, topicId: opts.topicId ?? null, status: 'published', source: 'human' }).returning({ id: catalogQuestions.id });
      const [v] = await db.insert(catalogQuestionVersions).values({ questionId: q!.id, versionNo: 1, content: content as never, metadata: { seed_key: key, number: opts.number ?? null } }).returning({ id: catalogQuestionVersions.id });
      await db.update(catalogQuestions).set({ currentVersionId: v!.id }).where(eq(catalogQuestions.id, q!.id));
      return q!.id;
    };
    const opts4 = (tag: string) => ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: `(${k}) ${tag}` }));

    fx.p1 = [
      await question('s4-p1-a', 'part1', { type: 'mcq_single', stem: '', options: opts4('ZEBRA-P1A-OPT'), answer_key: { correct: 'B' }, evidence: 'ZEBRA-P1A-EVIDENCE typing', media: { audio_asset_id: fx.p1Audio[0], image_asset_id: fx.svgId, listen_policy: 'once', pause_ms: 5000 }, tags: [] }),
      await question('s4-p1-b', 'part1', { type: 'mcq_single', stem: '', options: opts4(''), answer_key: { correct: 'A' }, media: { audio_asset_id: fx.p1Audio[1], image_asset_id: fx.svgId, listen_policy: 'once', pause_ms: 5000 }, tags: [] }),
    ];
    fx.p3Passage = await passage('s4-p3', 'W: ZEBRA-P3-SCRIPT Hi, I am calling about the order.\nM: It ships tomorrow.', fx.p3Audio);
    fx.p3 = [];
    for (let k = 1; k <= 3; k++) {
      fx.p3.push(await question(`s4-p3-${k}`, 'part3', { type: 'mcq_single', stem: `Question ${k}: What is the woman calling about?`, options: [{ key: 'A', text: 'An order' }, { key: 'B', text: 'A refund' }, { key: 'C', text: 'A job' }, { key: 'D', text: 'A trip' }], answer_key: { correct: 'A' }, evidence: 'calling about the order', media: { listen_policy: 'once' }, tags: [] }, { passageId: fx.p3Passage, number: 31 + k }));
    }
    fx.p4Groups = [];
    for (let g = 1; g <= 3; g++) {
      const pid = await passage(`s4-p4-g${g}`, `ZEBRA-P4-G${g} Good morning, this is a talk number ${g}.`, null);
      const ids: string[] = [];
      for (let k = 1; k <= 3; k++) ids.push(await question(`s4-p4-g${g}-${k}`, 'part4', { type: 'mcq_single', stem: `Talk ${g} question ${k}?`, options: [{ key: 'A', text: 'x' }, { key: 'B', text: 'y' }, { key: 'C', text: 'z' }, { key: 'D', text: 'w' }], answer_key: { correct: 'C' }, media: { listen_policy: 'once' }, tags: [] }, { passageId: pid, topicId: topic!.id, number: k }));
      // Câu đầu nhóm số 1 đặt trước để kiểm tra thứ tự theo metadata.number
      fx.p4Groups.push(ids);
    }
    fx.reading = (await db.select({ id: catalogQuestions.id }).from(catalogQuestions).innerJoin(catalogSections, eq(catalogSections.id, catalogQuestions.sectionId)).where(and(eq(catalogSections.code, 'part5'), eq(catalogQuestions.status, 'published'), eq(catalogQuestions.programCode, 'toeic'))).orderBy(catalogQuestions.createdAt).limit(2)).map((r) => r.id);
    expect(fx.reading).toHaveLength(2);

    // Đề L&R nhỏ (topic_pack – không lẫn vào danh sách mini)
    const [ts] = await db
      .insert(catalogTestSets)
      .values({ programCode: 'toeic', code: 's4-fixture-lr', title: { vi: 'S4 fixture L&R', en: 'S4 fixture L&R' }, kind: 'topic_pack', isFree: true, durationSec: 600, status: 'published', publishedAt: new Date() })
      .onConflictDoUpdate({ target: [catalogTestSets.programCode, catalogTestSets.code], set: { status: 'published', durationSec: 600 } })
      .returning({ id: catalogTestSets.id });
    fx.testSetId = ts!.id;
    await db.delete(catalogTestSetSections).where(eq(catalogTestSetSections.testSetId, fx.testSetId));
    await db.insert(catalogTestSetSections).values(['part1', 'part3', 'part5'].map((c, i) => ({ testSetId: fx.testSetId, sectionId: sections.get(c)!, sortOrder: i + 1, durationSec: null })));
    await db.delete(catalogTestSetItems).where(eq(catalogTestSetItems.testSetId, fx.testSetId));
    const items = [...fx.p1.map((id) => ({ id, s: 'part1', g: null })), ...fx.p3.map((id) => ({ id, s: 'part3', g: 'g-p3' })), ...fx.reading.map((id) => ({ id, s: 'part5', g: null }))];
    await db.insert(catalogTestSetItems).values(items.map((it, i) => ({ testSetId: fx.testSetId, questionId: it.id, sectionId: sections.get(it.s)!, sortOrder: i + 1, groupKey: it.g, points: '1' })));
  });

  afterAll(async () => {
    delete process.env.JOBS_INLINE;
    delete process.env.CATALOG_CACHE_TTL_SECONDS;
    await app?.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  type Q = { question_id: string; question_version_id: string; section_code: string; group_key: string | null; content: Record<string, unknown>; media: Array<{ id: string; kind: string; url: string; expires_at?: string | null }>; passage: { id: string; kind: string; body: string | null; media_url: string | null; media_asset_id?: string | null; media_expires_at?: string | null } | null };
  const startExam = async (api: ReturnType<typeof client>) => {
    const r = await api.call('POST', '/attempts', { program: 'toeic', mode: 'exam', test_set_id: fx.testSetId }, { 'idempotency-key': crypto.randomUUID() });
    expect(r.status).toBe(201);
    return r.body as { id: string; questions: Q[]; audio_plays?: Record<string, number> };
  };

  it('exam: GET/POST /attempts không lộ transcript (Part 1/2 chữ bị xoá, passage audio_script body = null); media có expires_at', async () => {
    const api = await guest();
    const att = await startExam(api);
    expect(att.questions).toHaveLength(7);
    // test_set.kind là kind thật của đề (không gán cứng 'mini')
    expect((att as unknown as { test_set: { kind: string } }).test_set.kind).toBe('topic_pack');
    expect((await api.call('GET', `/attempts/${att.id}`)).body.test_set.kind).toBe('topic_pack');
    for (const body of [att, (await api.call('GET', `/attempts/${att.id}`)).body]) {
      const json = JSON.stringify(body);
      expect(json).not.toContain('ZEBRA');
      expect(json).not.toContain('evidence');
      expect(json).not.toContain('answer_key');
    }
    const p1 = att.questions.find((q) => q.question_id === fx.p1[0])!;
    expect((p1.content.options as Array<{ key: string; text: string }>).map((o) => [o.key, o.text])).toEqual([
      ['A', ''],
      ['B', ''],
      ['C', ''],
      ['D', ''],
    ]);
    expect(p1.content.media).toMatchObject({ listen_policy: 'once', pause_ms: 5000 });
    const kinds = p1.media.map((m) => m.kind).sort();
    expect(kinds).toEqual(['audio', 'image']);
    for (const m of p1.media) expect(Date.parse(m.expires_at!) - Date.now()).toBeGreaterThan(9 * 60_000);
    const p3 = att.questions.find((q) => q.question_id === fx.p3[0])!;
    expect(p3.passage).toMatchObject({ id: fx.p3Passage, kind: 'audio_script', body: null, media_asset_id: fx.p3Audio });
    expect(p3.passage!.media_url).toBeTruthy();
    expect(Date.parse(p3.passage!.media_expires_at!)).toBeGreaterThan(Date.now());
    // Part 3: câu hỏi và lựa chọn in trên đề → giữ chữ
    expect(p3.content.stem).toContain('What is the woman calling about?');
    // Câu đọc (Part 5) không bị ảnh hưởng
    const p5 = att.questions.find((q) => q.section_code === 'part5')!;
    expect((p5.content.options as Array<{ text: string }>).some((o) => o.text.length > 0)).toBe(true);
    await api.call('POST', `/attempts/${att.id}/submit`);
    // Sau khi nộp GET /attempts vẫn không trả transcript (chỉ Review)
    expect(JSON.stringify((await api.call('GET', `/attempts/${att.id}`)).body)).not.toContain('ZEBRA');
  });

  it('sự kiện audio → audio_plays; review trả transcript (passage + media segments), chữ Part 1, community_avg_time_ms; kết quả L&R có khoảng ước tính', async () => {
    const api = await guest();
    const att = await startExam(api);
    const p1a = fx.p1[0]!;
    const ev = (meta: Record<string, unknown>, type = 'audio_started') => api.call('POST', `/attempts/${att.id}/events`, { type, meta });
    expect((await ev({ question_id: p1a, asset_id: fx.p1Audio[0], position_ms: 0 })).status).toBe(202);
    expect((await ev({ question_id: p1a, asset_id: fx.p1Audio[0] })).status).toBe(202);
    expect((await ev({ question_id: p1a }, 'audio_ended')).status).toBe(202);
    expect((await ev({ question_id: fx.p4Groups[0]![0] })).status).toBe(202); // không thuộc attempt → không đếm
    expect((await ev({ question_id: 'not-a-uuid' })).status).toBe(400);
    const g = await api.call('GET', `/attempts/${att.id}`);
    expect(g.body.audio_plays).toEqual({ [p1a]: 2 });

    const before = await dbs.db.select({ id: catalogQuestions.id, exposure: catalogQuestions.exposureCount }).from(catalogQuestions).where(eq(catalogQuestions.id, p1a));
    const answers = att.questions.map((q) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: 'A' }, time_spent_ms: 7000 }));
    expect((await api.call('PUT', `/attempts/${att.id}/answers`, { answers })).status).toBe(204);
    const res = await api.call('POST', `/attempts/${att.id}/submit`);
    expect(res.status).toBe(200);
    const after = await dbs.db.select({ exposure: catalogQuestions.exposureCount, avg: catalogQuestions.avgTimeMs }).from(catalogQuestions).where(eq(catalogQuestions.id, p1a));
    expect(after[0]!.exposure).toBe(before[0]!.exposure + 1);
    expect(after[0]!.avg).toEqual(expect.any(Number));

    // Điểm L&R (ước tính): Listening 5 câu, Reading 2 câu → cả hai kỹ năng, tổng = L + R, khoảng ±25 trong biên
    const s = res.body.scaled;
    expect(s).toMatchObject({ estimated: true, listening: expect.any(Number), reading: expect.any(Number) });
    expect(s.total).toBe(s.listening + s.reading);
    expect(s.range.low).toBe(Math.max(10, s.total - 25));
    expect(s.range.high).toBe(Math.min(990, s.total + 25));
    expect(s.ranges.listening.high).toBeLessThanOrEqual(495);
    expect(res.body.by_skill.listening).toMatchObject({ total: 5, scaled: s.listening, avg_time_ms: 7000 });
    expect(res.body.by_skill.reading).toMatchObject({ total: 2, scaled: s.reading });
    expect(Object.keys(res.body.by_section.part1)).toContain('community_avg_time_ms');
    expect(res.body.scale).toMatchObject({ estimated: true, range: s.range });
    // GET /result trả cùng cấu trúc và cùng XP đã cộng khi nộp
    const again = await api.call('GET', `/attempts/${att.id}/result`);
    expect(res.body.xp_earned).toBeGreaterThan(0);
    expect(again.body.xp_earned).toBe(res.body.xp_earned);
    expect(again.body.scaled).toEqual(s);
    expect(again.body.by_skill.listening.total).toBe(5);

    const review = await api.call('GET', `/attempts/${att.id}/review`);
    expect(review.status).toBe(200);
    const item = (qid: string) => review.body.items.find((i: { question: { question_id: string } }) => i.question.question_id === qid);
    const r1 = item(p1a);
    expect(r1.transcript_highlight).toMatchObject({ source: 'media', asset_id: fx.p1Audio[0], evidence: 'ZEBRA-P1A-EVIDENCE typing' });
    expect(r1.transcript_highlight.text).toContain('ZEBRA-P1A-AUDIO');
    expect(r1.transcript_highlight.segments).toHaveLength(2);
    expect(r1.question.content.options[1].text).toContain('ZEBRA-P1A-OPT');
    expect(r1.audio_plays).toBe(2);
    expect(r1.community_avg_time_ms).toEqual(expect.any(Number));
    expect(item(fx.p1[1]!).transcript_highlight).toMatchObject({ source: 'media', text: 'ZEBRA-P1B-AUDIO (A) A man is cooking.' });
    const r3 = item(fx.p3[1]!);
    expect(r3.transcript_highlight).toMatchObject({ source: 'passage', asset_id: fx.p3Audio });
    expect(r3.transcript_highlight.text).toContain('ZEBRA-P3-SCRIPT');
    expect(r3.transcript_highlight.segments[0].speaker).toBe('W');
    expect(r3.question.passage.body).toContain('ZEBRA-P3-SCRIPT');
    // Câu đọc: không có transcript
    expect(item(fx.reading[0]!).transcript_highlight).toBeNull();
  });

  it('GET /attempts/{id}/media: URL ký mới cho mọi asset (câu, passage), SVG phát được với Content-Type image/svg+xml; người khác → 404', async () => {
    const api = await guest();
    const att = await startExam(api);
    const r = await api.call('GET', `/attempts/${att.id}/media`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const ids = (r.body.data as Array<{ id: string }>).map((d) => d.id).sort();
    expect(ids).toEqual([fx.svgId, ...fx.p1Audio, fx.p3Audio].sort());
    for (const d of r.body.data as Array<{ url: string; expires_at: string; kind: string }>) {
      expect(d.url).toContain('/v1/storage/fs/');
      expect(Date.parse(d.expires_at) - Date.now()).toBeGreaterThan(9 * 60_000);
    }
    const svg = (r.body.data as Array<{ id: string; url: string }>).find((d) => d.id === fx.svgId)!;
    const u = new URL(svg.url);
    const file = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: `${u.pathname}${u.search}` });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/svg+xml');
    expect(String(file.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(file.body).toContain('<svg');

    const other = await guest();
    expect((await other.call('GET', `/attempts/${att.id}/media`)).status).toBe(404);
    expect((await api.call('GET', `/attempts/${crypto.randomUUID()}/media`)).status).toBe(404);
  });

  it('SVG: CMS được presign image/svg+xml, người học không; SVG có script / SVG giả PNG trong tải lên người học → failed', async () => {
    const cms = client(app);
    const pre = await cms.call('POST', '/internal/media/presign', { kind: 'image', mime_type: 'image/svg+xml', size_bytes: Buffer.byteLength(SVG) }, INTERNAL);
    expect(pre.status).toBe(201);
    const u = new URL(pre.body.upload_url as string);
    const put = await app.getHttpAdapter().getInstance().inject({ method: 'PUT', url: `${u.pathname}${u.search}`, payload: Buffer.from(SVG), headers: { 'content-type': 'image/svg+xml' } });
    expect(put.statusCode).toBe(200);
    const processed = await app.get(MediaProcessorService).process(pre.body.media_asset_id as string);
    expect(processed.status).toBe('ready');
    const [row] = await dbs.db.select().from(catalogMediaAssets).where(eq(catalogMediaAssets.id, pre.body.media_asset_id as string));
    expect(row).toMatchObject({ mimeType: 'image/svg+xml', width: 320, height: 240, status: 'ready' });
    expect(row!.storageKey).toMatch(/image\.svg$/);

    const learner = await guest();
    expect((await learner.call('POST', '/uploads/presign', { kind: 'image', mime_type: 'image/svg+xml', size_bytes: 1000 })).status).toBe(400);

    const media = app.get(MediaAssetsService);
    const evil = await media.createContentAsset({ kind: 'image', mimeType: 'image/svg+xml', body: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><!-- ${Date.now()} --></svg>`) });
    expect(evil).toMatchObject({ status: 'failed', error: { code: 'unsupported_media' } });
    const onload = await media.createContentAsset({ kind: 'image', mimeType: 'image/svg+xml', body: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><!-- ${Date.now()} --></svg>`) });
    expect(onload.status).toBe('failed');

    // Người học khai báo PNG nhưng tải SVG lên → bị từ chối khi xử lý (bucket recordings)
    const up = await media.createUpload({ kind: 'image', mimeType: 'image/png', sizeBytes: Buffer.byteLength(SVG), origin: 'learner_upload', bucket: 'recordings' });
    const pu = new URL(up.uploadUrl);
    await app.getHttpAdapter().getInstance().inject({ method: 'PUT', url: `${pu.pathname}${pu.search}`, payload: Buffer.from(SVG), headers: { 'content-type': 'image/png' } });
    expect(await app.get(MediaProcessorService).process(up.mediaAssetId)).toMatchObject({ status: 'failed', code: 'unsupported_media' });
  });

  it('practice drill: nhóm Part 4 lấy trọn (group_key = passage), transcript chỉ hiện khi mọi câu trong nhóm đã trả lời', async () => {
    const api = await guest();
    const r = await api.call('GET', `/practice/questions?program=toeic&section=part4&topic=${TOPIC}&count=3`);
    expect(r.status).toBe(201);
    expect(r.body.mode).toBe('drill');
    expect(r.body.expires_at).toBeNull();
    const qs = r.body.questions as Q[];
    expect(qs).toHaveLength(3);
    expect(new Set(qs.map((q) => q.group_key)).size).toBe(1);
    expect(qs[0]!.group_key).toBe(qs[0]!.passage!.id);
    expect(qs.map((q) => (q.content.stem as string).replace(/^Talk \d+ /, ''))).toEqual(['question 1?', 'question 2?', 'question 3?']);
    expect(JSON.stringify(r.body)).not.toContain('ZEBRA');
    const ans = (q: Q) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: 'C' }, time_spent_ms: 3000 });
    await api.call('PUT', `/attempts/${r.body.id}/answers`, { answers: [ans(qs[0]!), ans(qs[1]!)] });
    const partial = await api.call('GET', `/attempts/${r.body.id}`);
    expect(partial.body.feedback[qs[0]!.question_id]).toMatchObject({ is_correct: true, correct_answer: 'C', transcript: null });
    expect(JSON.stringify(partial.body)).not.toContain('ZEBRA');
    await api.call('PUT', `/attempts/${r.body.id}/answers`, { answers: [ans(qs[2]!)] });
    const full = await api.call('GET', `/attempts/${r.body.id}`);
    for (const q of qs) expect(full.body.feedback[q.question_id].transcript).toMatchObject({ source: 'passage', text: expect.stringContaining('ZEBRA-P4-G') });
    // passage body vẫn ẩn trong questions (chỉ feedback/review)
    expect((full.body.questions as Q[]).every((q) => q.passage!.body === null)).toBe(true);
  });

  it('practice Part 6/7 (Reading): lấy trọn nhóm passage, liền nhau, group_key = passage id, thứ tự theo số câu gốc', async () => {
    const api = await guest();
    for (const [section, count] of [
      ['part6', 4],
      ['part7', 5],
    ] as const) {
      const r = await api.call('GET', `/practice/questions?program=toeic&section=${section}&count=${count}`);
      expect(r.status).toBe(201);
      const qs = r.body.questions as Q[];
      expect(qs.every((q) => q.passage && q.group_key === q.passage.id)).toBe(true);
      // mỗi nhóm liền nhau và đủ mọi câu đã phát hành của passage
      const seen: string[] = [];
      for (const q of qs) if (seen.at(-1) !== q.group_key) seen.push(q.group_key!);
      expect(new Set(seen).size).toBe(seen.length);
      for (const g of seen) {
        const [n] = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(catalogQuestions).where(and(eq(catalogQuestions.passageId, g), eq(catalogQuestions.status, 'published')));
        expect(qs.filter((q) => q.group_key === g)).toHaveLength(n!.n);
      }
      // thứ tự trong nhóm theo metadata.number của phiên bản
      const versions = await dbs.db.select({ id: catalogQuestionVersions.id, number: sql<number | null>`(${catalogQuestionVersions.metadata} ->> 'number')::int` }).from(catalogQuestionVersions).where(inArray(catalogQuestionVersions.id, qs.map((q) => q.question_version_id)));
      const num = new Map(versions.map((v) => [v.id, v.number]));
      for (const g of seen) {
        const nums = qs.filter((q) => q.group_key === g).map((q) => num.get(q.question_version_id) ?? 0);
        expect([...nums].sort((a, b) => a - b)).toEqual(nums);
      }
    }
  });

  it('timed_drill: hạn = Σ giây theo Part (Part 4: 35 s/câu) hoặc per_question_sec; không feedback trước khi nộp', async () => {
    const api = await guest();
    const r = await api.call('GET', `/practice/questions?program=toeic&section=part4&topic=${TOPIC}&count=3&timed=true`);
    expect(r.status).toBe(201);
    expect(r.body.mode).toBe('timed_drill');
    const secs = (Date.parse(r.body.expires_at) - Date.parse(r.body.server_time)) / 1000;
    expect(secs).toBeGreaterThan(103);
    expect(secs).toBeLessThanOrEqual(105);
    await api.call('PUT', `/attempts/${r.body.id}/answers`, { answers: [{ question_id: r.body.questions[0].question_id, answer: { type: 'mcq_single', selected: 'C' } }] });
    expect((await api.call('GET', `/attempts/${r.body.id}`)).body.feedback).toBeUndefined();
    const o = await api.call('GET', `/practice/questions?program=toeic&section=part4&topic=${TOPIC}&count=3&timed=true&per_question_sec=10`);
    expect((Date.parse(o.body.expires_at) - Date.parse(o.body.server_time)) / 1000).toBeLessThanOrEqual(30);
    expect((await api.call('GET', `/practice/questions?program=toeic&section=part4&count=3&timed=true&per_question_sec=1`)).status).toBe(400);
  });

  it('nguồn câu luyện: chưa làm → sai trong 30 ngày → còn lại; số câu theo nhóm trọn vẹn (count 5 → 6, count 4 → 3)', async () => {
    const api = await guest();
    const groupOf = (qid: string) => fx.p4Groups.findIndex((g) => g.includes(qid));
    const practice = async (count: number) => {
      const r = await api.call('GET', `/practice/questions?program=toeic&section=part4&topic=${TOPIC}&count=${count}`);
      expect(r.status).toBe(201);
      return r.body as { id: string; questions: Q[] };
    };
    const finish = async (att: { id: string; questions: Q[] }, selected: string) => {
      await api.call('PUT', `/attempts/${att.id}/answers`, { answers: att.questions.map((q) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected } })) });
      expect((await api.call('POST', `/attempts/${att.id}/submit`)).status).toBe(200);
    };
    const first = await practice(3);
    const wrongGroup = groupOf(first.questions[0]!.question_id);
    expect(first.questions.every((q) => groupOf(q.question_id) === wrongGroup)).toBe(true);
    await finish(first, 'A'); // sai cả nhóm

    const second = await practice(5); // 5 → 6 câu (2 nhóm) vì gần hơn 3
    expect(second.questions).toHaveLength(6);
    const groups2 = second.questions.map((q) => groupOf(q.question_id));
    expect(groups2).not.toContain(wrongGroup); // ưu tiên nhóm chưa làm
    expect(groups2.slice(0, 3).every((g) => g === groups2[0]) && groups2.slice(3).every((g) => g === groups2[3])).toBe(true); // liền nhau
    await finish(second, 'C'); // đúng hết

    const third = await practice(4); // 4 → 3 câu; mọi nhóm đã làm → nhóm sai gần đây trước
    expect(third.questions).toHaveLength(3);
    expect(third.questions.every((q) => groupOf(q.question_id) === wrongGroup)).toBe(true);
  });

  it('mini test generator (admin): seed 42 lặp lại được, cấu trúc mini hợp lệ, có shortfall khi ngân hàng thiếu; learner 403; attempt từ đề sinh ra có điểm L&R', async () => {
    const admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    const gen = await admin.call('POST', '/admin/test-sets/generate', { program: 'toeic', seed: 42 });
    expect(gen.status).toBe(201);
    expect(gen.body).toMatchObject({ code: 'toeic-mini-gen-42', status: 'published', seed: 42, structure: { ok: true }, blueprint: { code: 'toeic_lr_mini_60_v1' } });
    expect(gen.body.question_count).toBeGreaterThan(0);
    expect(gen.body.question_count).toBeLessThanOrEqual(60);
    expect(gen.body.by_section.part5).toBe(10);
    expect(gen.body.by_section.part6).toBe(4);
    expect(gen.body.by_section.part7).toBe(12);
    const items = async (id: string) => (await dbs.db.select({ q: catalogTestSetItems.questionId, o: catalogTestSetItems.sortOrder, g: catalogTestSetItems.groupKey }).from(catalogTestSetItems).where(eq(catalogTestSetItems.testSetId, id)).orderBy(catalogTestSetItems.sortOrder));
    const first = await items(gen.body.test_set_id as string);
    expect(first).toHaveLength(gen.body.question_count as number);
    const again = await admin.call('POST', '/admin/test-sets/generate', { program: 'toeic', seed: 42 });
    expect(again.body.test_set_id).toBe(gen.body.test_set_id);
    expect(again.body.bank_fingerprint).toBe(gen.body.bank_fingerprint);
    expect(await items(again.body.test_set_id as string)).toEqual(first);
    const other = await admin.call('POST', '/admin/test-sets/generate', { program: 'toeic', seed: 43, publish: false });
    expect(other.body).toMatchObject({ code: 'toeic-mini-gen-43', status: 'draft' });
    expect((await items(other.body.test_set_id as string)).map((x) => x.q)).not.toEqual(first.map((x) => x.q));
    // seed/blueprint lưu trong audit (test_sets không có cột metadata – SPEC-ISSUES S30)
    const [audit] = await dbs.db.select({ after: schema.opsAuditLogs.after }).from(schema.opsAuditLogs).where(and(eq(schema.opsAuditLogs.action, 'test_set.generated'), eq(schema.opsAuditLogs.entityId, gen.body.test_set_id as string))).limit(1);
    expect(audit!.after).toMatchObject({ seed: 42, blueprint: { code: 'toeic_lr_mini_60_v1' } });
    // blueprint vượt chuẩn section → 400; learner → 403
    expect((await admin.call('POST', '/admin/test-sets/generate', { program: 'toeic', seed: 1, blueprint: { code: 'x', sections: [{ section_code: 'part1', count: 7 }] } })).status).toBe(400);
    const learner = await guest();
    expect((await learner.call('POST', '/admin/test-sets/generate', { program: 'toeic', seed: 1 })).status).toBe(403);

    // Người học làm đề sinh ra (mini, đã phát hành) → kết quả có Listening + Reading
    const att = await learner.call('POST', '/attempts', { program: 'toeic', mode: 'exam', test_set_id: gen.body.test_set_id }, { 'idempotency-key': crypto.randomUUID() });
    expect(att.status).toBe(201);
    expect(att.body.test_set.kind).toBe('mini');
    expect(att.body.questions).toHaveLength(gen.body.question_count as number);
    const res = await learner.call('POST', `/attempts/${att.body.id}/submit`);
    expect(res.body.scaled).toMatchObject({ estimated: true });
    expect(res.body.scaled.reading).toBe(5);
    expect(Object.keys(res.body.by_skill)).toEqual(expect.arrayContaining(['reading']));
  });

  it('bumpQuestionStats gộp: nhiều câu cập nhật exposure_count trong một lượt nộp', async () => {
    const ids = fx.p3;
    const before = new Map((await dbs.db.select({ id: catalogQuestions.id, n: catalogQuestions.exposureCount }).from(catalogQuestions).where(inArray(catalogQuestions.id, ids))).map((r) => [r.id, r.n]));
    const api = await guest();
    const att = await startExam(api);
    await api.call('POST', `/attempts/${att.id}/submit`);
    const after = await dbs.db.select({ id: catalogQuestions.id, n: catalogQuestions.exposureCount }).from(catalogQuestions).where(inArray(catalogQuestions.id, ids));
    for (const r of after) expect(r.n).toBe(before.get(r.id)! + 1);
  });
});
