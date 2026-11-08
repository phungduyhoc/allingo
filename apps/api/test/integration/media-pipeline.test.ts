import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { loadEnv } from '../../src/config/env.js';
import { DbService } from '../../src/shared/db/db.module.js';
import { RedisService } from '../../src/shared/cache/redis.module.js';
import { QueueService } from '../../src/shared/queue/queue.module.js';
import { DeletionService } from '../../src/modules/iam/index.js';
import { ffmpeg, MediaAssetsService, MediaProcessorService, mediaJobHandlers, MOCK_MS_PER_WORD, SPEECH_PROVIDER, countWords, type SpeechProvider } from '../../src/modules/speech/index.js';
import { bootTestApp, client } from './setup.js';

const cfg = ffmpeg.DEFAULT_FFMPEG;
const hasFfmpeg = ffmpeg.ffmpegAvailable(cfg);
const uniq = () => Math.random().toString(36).slice(2, 10);

/**
 * Sprint 2 – media pipeline + TTS (APP_ENV=test → driver fs, thư mục tạm; QUEUE_PREFIX riêng để worker dev không lấy job):
 * presign → PUT trực tiếp → media.process (BullMQ worker trong test hoặc inline khi Redis degrade) → media_assets ready.
 */
describe.skipIf(!hasFfmpeg)('media pipeline & TTS (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let token: string;
  let worker: Worker | null = null;
  let workerConn: ReturnType<RedisService['duplicateForQueue']> | null = null;
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allingo-storage-it-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'allingo-media-it-'));
  const prefix = `allingo-test-${uniq()}`;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = '';
    process.env.STORAGE_FS_DIR = storageDir;
    process.env.QUEUE_PREFIX = prefix;
    app = await bootTestApp();
    dbs = app.get(DbService);
    token = loadEnv().INTERNAL_API_TOKEN;
  });

  afterAll(async () => {
    await worker?.close().catch(() => undefined);
    await workerConn?.quit().catch(() => undefined);
    await app?.get(QueueService).get('media').obliterate({ force: true }).catch(() => undefined);
    await app?.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const fastify = () => app.getHttpAdapter().getInstance();
  const rel = (url: string) => {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  };
  const put = (url: string, body: Buffer, contentType: string) => fastify().inject({ method: 'PUT', url: rel(url), payload: body, headers: { 'content-type': contentType } });
  const get = (url: string, headers: Record<string, string> = {}) => fastify().inject({ method: 'GET', url: rel(url), headers });
  const internal = { 'x-internal-token': '' };
  const ih = () => ({ ...internal, 'x-internal-token': token });

  function startWorker() {
    const processor = app.get(MediaProcessorService);
    const handlers = mediaJobHandlers(processor);
    workerConn = app.get(RedisService).duplicateForQueue();
    worker = new Worker('media', async (job) => handlers[job.name]!(job), { connection: workerConn, prefix, concurrency: 1 });
  }

  async function waitStatus(api: ReturnType<typeof client>, id: string, want: string[], timeoutMs = 60_000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const r = await api.call('GET', `/internal/media/${id}`, undefined, ih());
      if (want.includes(r.body.status as string) || Date.now() > until) return r;
      await new Promise((res) => setTimeout(res, 250));
    }
  }

  it('presign recording (khách = Free) → learn.recordings hạn 90 ngày; PUT trực tiếp; sai Content-Type → 403; chưa đăng nhập → 401', async () => {
    const api = client(app);
    expect((await api.call('POST', '/uploads/presign', { kind: 'recording', mime_type: 'audio/webm', size_bytes: 1000 })).status).toBe(401);
    await api.call('POST', '/auth/guest', {});
    const body = Buffer.alloc(4096, 7);
    const r = await api.call('POST', '/uploads/presign', { kind: 'recording', mime_type: 'audio/webm;codecs=opus', size_bytes: body.length, duration_ms: 3000 });
    expect(r.status).toBe(201);
    expect(r.body.upload_url).toContain('/v1/storage/fs/recordings/rec/');
    expect(new Date(r.body.expires_at as string).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    const [rec] = await dbs.db.select().from(schema.learnRecordings).where(eq(schema.learnRecordings.id, r.body.resource_id as string));
    expect(rec).toMatchObject({ mimeType: 'audio/webm', sizeBytes: body.length, durationMs: 3000 });
    const days = (rec!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
    expect((await put(r.body.upload_url as string, body, 'audio/mpeg')).statusCode).toBe(403);
    expect((await put(r.body.upload_url as string, Buffer.alloc(body.length + 1), 'audio/webm')).statusCode).toBe(413);
    const ok = await put(r.body.upload_url as string, body, 'audio/webm;codecs=opus');
    expect(ok.statusCode).toBe(200);
    expect(fs.existsSync(path.join(storageDir, loadEnv().S3_BUCKET_RECORDINGS, rec!.storageKey))).toBe(true);
  });

  it('validate presign: > 20 MB → 400, MIME không cho phép → 400, MIME khác kind → 400', async () => {
    const api = client(app);
    await api.call('POST', '/auth/guest', {});
    const big = await api.call('POST', '/uploads/presign', { kind: 'recording', mime_type: 'audio/mpeg', size_bytes: 20 * 1024 * 1024 + 1 });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('validation_failed');
    expect((await api.call('POST', '/uploads/presign', { kind: 'recording', mime_type: 'video/mp4', size_bytes: 1000 })).status).toBe(400);
    expect((await api.call('POST', '/uploads/presign', { kind: 'image', mime_type: 'audio/wav', size_bytes: 1000 })).status).toBe(400);
    expect((await api.call('POST', '/uploads/presign', { kind: 'image', mime_type: 'image/gif', size_bytes: 1000 })).status).toBe(400);
  });

  it('audio ~5 MB: presign nội bộ → PUT → job media.process (BullMQ) → ready + duration + waveform 200; URL ký 10 phút phát được (Range); giả mạo → 403', async () => {
    startWorker();
    const api = client(app);
    const wav = path.join(tmp, 'listening.wav');
    await ffmpeg.generateTestMedia(cfg, { kind: 'sine', durationMs: 58_000, sampleRate: 44_100, format: 'wav' }, wav);
    const data = fs.readFileSync(wav);
    expect(data.length).toBeGreaterThan(5_000_000);
    const p = await api.call('POST', '/internal/media/presign', { kind: 'audio', mime_type: 'audio/wav', size_bytes: data.length }, ih());
    expect(p.status).toBe(201);
    const id = p.body.media_asset_id as string;
    // Chưa tải lên → 409
    const early = await api.call('POST', '/internal/media/process', { media_asset_id: id }, ih());
    expect(early.status).toBe(409);
    expect((await put(p.body.upload_url as string, data, 'audio/wav')).statusCode).toBe(200);

    const q = await api.call('POST', '/internal/media/process', { media_asset_id: id }, ih());
    expect(q.status).toBe(202);
    expect(q.body).toMatchObject({ status: 'processing', mode: 'queued' });
    const v = await waitStatus(api, id, ['ready', 'failed']);
    expect(v.body.status).toBe('ready');
    expect(v.body.mime_type).toBe('audio/mpeg');
    expect(Math.abs((v.body.duration_ms as number) - 58_000)).toBeLessThan(200);
    expect(v.body.waveform.count).toBe(200);
    expect(Math.max(...(v.body.waveform.peaks as number[]))).toBeGreaterThan(0.1);
    expect(new Date(v.body.url_expires_at as string).getTime() - Date.now()).toBeLessThanOrEqual(600_000);
    expect(v.body.url).toContain('/v1/storage/fs/media/content/');

    const [row] = await dbs.db.select().from(schema.catalogMediaAssets).where(eq(schema.catalogMediaAssets.id, id));
    expect(row!.storageKey).toMatch(/\/audio\.mp3$/);
    expect((row!.metadata as { original?: { key: string } }).original?.key).toMatch(/original\.wav$/);
    expect(row!.sizeBytes).toBeLessThan(data.length / 5);

    const audio = await get(v.body.url as string);
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/mpeg');
    expect(audio.rawPayload.length).toBe(row!.sizeBytes);
    const ranged = await get(v.body.url as string, { range: 'bytes=0-99' });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.rawPayload.length).toBe(100);
    const tampered = (v.body.url as string).replace(/sig=[^&]+/, 'sig=AAAA');
    expect((await get(tampered)).statusCode).toBe(403);
    // Đã ready → gọi lại là noop (idempotent)
    const again = await api.call('POST', '/internal/media/process', { media_asset_id: id }, ih());
    expect(again.body).toMatchObject({ status: 'ready', mode: 'noop' });
  });

  it('ảnh người học (bucket recordings) + Redis degrade → xử lý đồng bộ: WebP + thumbnail 320 px', async () => {
    const api = client(app);
    await api.call('POST', '/auth/guest', {});
    const png = path.join(tmp, 'chart.png');
    await ffmpeg.generateTestMedia(cfg, { kind: 'image', width: 800, height: 600, format: 'png' }, png);
    const data = fs.readFileSync(png);
    const p = await api.call('POST', '/uploads/presign', { kind: 'image', mime_type: 'image/png', size_bytes: data.length });
    expect(p.status).toBe(201);
    expect(p.body.upload_url).toContain('/v1/storage/fs/recordings/uploads/');
    expect((await put(p.body.upload_url as string, data, 'image/png')).statusCode).toBe(200);

    const redis = app.get(RedisService);
    const spy = vi.spyOn(redis, 'isHealthy', 'get').mockReturnValue(false);
    try {
      const r = await api.call('POST', '/internal/media/process', { media_asset_id: p.body.resource_id }, ih());
      expect(r.status).toBe(202);
      expect(r.body).toMatchObject({ status: 'ready', mode: 'inline' });
    } finally {
      spy.mockRestore();
    }
    const v = await api.call('GET', `/internal/media/${p.body.resource_id as string}`, undefined, ih());
    expect(v.body).toMatchObject({ status: 'ready', mime_type: 'image/webp', width: 800, height: 600 });
    expect(v.body.url).toContain('/v1/storage/fs/recordings/');
    const thumb = await get(v.body.thumbnail_url as string);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    const f = path.join(tmp, 'thumb.webp');
    fs.writeFileSync(f, thumb.rawPayload);
    expect((await ffmpeg.probeMedia(cfg, f, 'webp_pipe')).streams[0]).toMatchObject({ width: 320, height: 240 });
  });

  it('xoá tài khoản: ảnh người học bị xoá mọi tệp (gốc, webp, thumbnail), hàng media_assets không còn khoá lưu trữ', async () => {
    const api = client(app);
    const reg = await api.call('POST', '/auth/register', { email: `upl-${uniq()}@example.com`, password: 'Hoc-vien#S12-xK9q', display_name: 'Uploader', accept_terms: true });
    expect(reg.status).toBe(201);
    const png = path.join(tmp, 'note.png');
    await ffmpeg.generateTestMedia(cfg, { kind: 'image', width: 400, height: 300, format: 'png' }, png);
    const data = fs.readFileSync(png);
    const p = await api.call('POST', '/uploads/presign', { kind: 'image', mime_type: 'image/png', size_bytes: data.length });
    expect((await put(p.body.upload_url as string, data, 'image/png')).statusCode).toBe(200);
    const redis = app.get(RedisService);
    const spy = vi.spyOn(redis, 'isHealthy', 'get').mockReturnValue(false);
    try {
      expect((await api.call('POST', '/internal/media/process', { media_asset_id: p.body.resource_id }, ih())).body.status).toBe('ready');
    } finally {
      spy.mockRestore();
    }
    const id = p.body.resource_id as string;
    const before = await api.call('GET', `/internal/media/${id}`, undefined, ih());
    expect((await get(before.body.url as string)).statusCode).toBe(200);
    expect((await get(before.body.thumbnail_url as string)).statusCode).toBe(200);
    const files = () =>
      fs
        .readdirSync(storageDir, { recursive: true })
        .map(String)
        .filter((f) => !f.startsWith('.meta') && f.includes(`/${id}/`) && fs.statSync(path.join(storageDir, f)).isFile());
    expect(files().length).toBeGreaterThanOrEqual(3);

    expect((await api.call('DELETE', '/me')).status).toBe(202);
    process.env.PURGE_DELAY_MINUTES = '0';
    // Purge trực tiếp yêu cầu của user này (không phụ thuộc hạn 72 giờ)
    const userId = reg.body.user.id as string;
    const [req] = await dbs.db.select().from(schema.iamDeletionRequests).where(eq(schema.iamDeletionRequests.userId, userId));
    await app.get(DeletionService).purgeOne(req!.id, userId);
    expect(files()).toHaveLength(0);
    const [row] = await dbs.db.select().from(schema.catalogMediaAssets).where(eq(schema.catalogMediaAssets.id, id));
    expect(row?.storageKey).toBeNull();
    expect(row?.status).toBe('failed');
    expect((row?.metadata as { purged_at?: string }).purged_at).toBeTruthy();
    expect((await get(before.body.url as string)).statusCode).toBe(404);
    // Idempotent: gọi lại không lỗi, không còn gì để xoá
    expect(await app.get(MediaAssetsService).purgeLearnerUploads(userId)).toBe(0);
  });

  it('tệp giả mạo (playlist văn bản khai báo audio/wav) → failed unsupported_media, không retry', async () => {
    const api = client(app);
    const fake = Buffer.from('#EXTM3U\n#EXTINF:10,\nfile:///etc/passwd\n');
    const p = await api.call('POST', '/internal/media/presign', { kind: 'audio', mime_type: 'audio/wav', size_bytes: fake.length }, ih());
    expect((await put(p.body.upload_url as string, fake, 'audio/wav')).statusCode).toBe(200);
    await api.call('POST', '/internal/media/process', { media_asset_id: p.body.media_asset_id }, ih());
    const v = await waitStatus(api, p.body.media_asset_id as string, ['failed', 'ready']);
    expect(v.body.status).toBe('failed');
    expect(v.body.error).toMatchObject({ code: 'unsupported_media' });
    expect(v.body.url).toBeNull();
  });

  it('TTS: lần 1 sinh audio + asset ready (duration ≈ số từ × 350 ms); lần 2 cache hit, không gọi provider, cùng asset', async () => {
    const api = client(app);
    const provider = app.get<SpeechProvider>(SPEECH_PROVIDER);
    const spy = vi.spyOn(provider, 'synthesize');
    const text = `Welcome to practice session ${uniq()}. Listen carefully to the announcement.`;
    const r1 = await api.call('POST', '/internal/media/tts', { text, locale: 'en-US' }, ih());
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ cached: false, duration_ms: countWords(text) * MOCK_MS_PER_WORD, voice: 'en-US-JennyNeural', provider: 'mock' });
    const r2 = await api.call('POST', '/internal/media/tts', { text: `  ${text.replace(/ /g, '  ')} `, locale: 'en-US' }, ih());
    expect(r2.body).toMatchObject({ cached: true, media_asset_id: r1.body.media_asset_id, duration_ms: r1.body.duration_ms });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    const [cacheRows] = await dbs.db.select().from(schema.aiTtsCache).where(eq(schema.aiTtsCache.voice, 'en-US-JennyNeural'));
    expect(cacheRows).toBeTruthy();
    const v = await api.call('GET', `/internal/media/${r1.body.media_asset_id as string}`, undefined, ih());
    expect(v.body).toMatchObject({ status: 'ready', kind: 'audio', mime_type: 'audio/mpeg' });
    expect(v.body.waveform.count).toBe(200);
    expect((await get(v.body.url as string)).statusCode).toBe(200);
    // Giọng không hợp lệ (chống chèn SSML) → 400
    expect((await api.call('POST', '/internal/media/tts', { text: 'hi', voice: 'x"><evil/>' }, ih())).status).toBe(400);
  });

  it('API nội bộ media yêu cầu X-Internal-Token', async () => {
    const api = client(app);
    expect((await api.call('POST', '/internal/media/presign', { kind: 'audio', mime_type: 'audio/wav', size_bytes: 10 })).status).toBe(401);
    expect((await api.call('POST', '/internal/media/tts', { text: 'hello' }, { 'x-internal-token': 'wrong' })).status).toBe(401);
  });
});
