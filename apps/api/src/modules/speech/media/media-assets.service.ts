import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../../shared/db/db.module.js';
import { RedisService } from '../../../shared/cache/redis.module.js';
import { PersonalDataRegistry } from '../../../shared/events/personal-data.registry.js';
import { QueueService } from '../../../shared/queue/queue.module.js';
import { Conflict, NotFound } from '../../../shared/http/errors.js';
import { baseMime, MAX_UPLOAD_BYTES, StorageService, type Bucket } from '../../../shared/storage/storage.module.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { computeWaveform, ffmpegAvailable, WAVEFORM_SAMPLE_RATE } from './ffmpeg.js';
import { MediaProcessorService, type MediaAssetRow } from './media-processor.service.js';
import { extForMime, MEDIA_PROCESS_JOB, MEDIA_QUEUE, metadataBucket, readMetadata, WAVEFORM_PEAKS, type MediaMetadata, type MediaOrigin } from './media.types.js';

const { catalogMediaAssets } = schema;

export interface CreateUploadInput {
  kind: 'audio' | 'image';
  mimeType: string;
  sizeBytes: number;
  origin: Exclude<MediaOrigin, 'tts'>;
  /** Ảnh người học → bucket recordings (dữ liệu cá nhân, CLAUDE.md §9); nội dung CMS → media */
  bucket: Bucket;
  createdBy?: string | null;
  license?: string;
}

export interface CreateUploadResult {
  mediaAssetId: string;
  uploadUrl: string;
  expiresAt: Date;
  storageKey: string;
}

export interface MediaAssetView {
  id: string;
  kind: string;
  status: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  url: string | null;
  thumbnail_url: string | null;
  url_expires_at: string | null;
  waveform: { count: number; sample_rate: number; peaks: number[] } | null;
  error: { code: string; message: string } | null;
  created_at: string;
  updated_at: string;
}

export type ProcessRequestMode = 'queued' | 'inline' | 'noop';

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms))]);

/**
 * Vòng đời catalog.media_assets cho pipeline media (ADR-0025). Ghi chú ranh giới (CLAUDE.md §5.1):
 * bảng thuộc catalog nhưng chỉ module speech ghi các cột trạng thái/xử lý (status, metadata, storage_key biến thể);
 * catalog chỉ đọc để phát URL. Ghi vào SPEC-ISSUES để chốt chủ sở hữu.
 */
@Injectable()
export class MediaAssetsService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'media.assets' });

  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    private readonly processor: MediaProcessorService,
    private readonly personalData: PersonalDataRegistry,
  ) {}

  onModuleInit(): void {
    this.personalData.register('learner_uploads', (userId) => this.purgeLearnerUploads(userId));
  }

  /**
   * Xoá tài khoản (iam.purge): xoá mọi tệp (gốc, biến thể, thumbnail) của ảnh người học rồi gỡ khoá lưu trữ khỏi hàng.
   * Giữ hàng media_assets (có thể được bài viết đã chấm tham chiếu qua attachment_id) nhưng không còn trỏ tới tệp nào.
   * Idempotent; tệp không xoá được → ném lỗi để lần quét sau thử lại.
   */
  async purgeLearnerUploads(userId: string): Promise<number> {
    const rows = await this.dbs.db
      .select({ id: catalogMediaAssets.id, storageKey: catalogMediaAssets.storageKey, metadata: catalogMediaAssets.metadata })
      .from(catalogMediaAssets)
      .where(and(eq(catalogMediaAssets.createdBy, userId), sql`${catalogMediaAssets.metadata}->>'origin' = 'learner_upload'`, sql`${catalogMediaAssets.metadata}->>'purged_at' IS NULL`));
    for (const r of rows) {
      const meta = readMetadata(r.metadata);
      const bucket = metadataBucket(meta);
      const keys = new Set<string>([r.storageKey, meta.original?.key, meta.thumbnail_key, ...Object.values(meta.variants ?? {}).map((v) => v.key)].filter((k): k is string => Boolean(k)));
      for (const key of keys) {
        if (!(await this.storage.deleteObject(bucket, key))) throw new Error(`cannot delete media object of asset ${r.id}`);
      }
      await this.dbs.db
        .update(catalogMediaAssets)
        .set({ storageKey: null, status: 'failed', metadata: { bucket, origin: 'learner_upload', purged_at: new Date().toISOString(), error: { code: 'purged', message: 'owner account deleted' } } })
        .where(eq(catalogMediaAssets.id, r.id));
    }
    return rows.length;
  }

  /** Tạo asset trạng thái `uploading` + URL PUT có hạn (10 phút) */
  async createUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
    if (input.sizeBytes > MAX_UPLOAD_BYTES) throw new Conflict('File too large');
    const id = randomUUID();
    const now = new Date();
    const mime = baseMime(input.mimeType);
    const prefix = input.origin === 'learner_upload' ? 'uploads' : 'content';
    const key = `${prefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}/original.${extForMime(mime)}`;
    const metadata: MediaMetadata = { bucket: input.bucket, origin: input.origin, original: { key, mime_type: mime, size_bytes: input.sizeBytes } };
    await this.dbs.db.insert(catalogMediaAssets).values({ id, kind: input.kind, storageKey: key, mimeType: mime, sizeBytes: input.sizeBytes, license: input.license ?? 'own', createdBy: input.createdBy ?? null, status: 'uploading', metadata });
    const ttl = this.storage.defaultTtlSec;
    const uploadUrl = await this.storage.presignPut(input.bucket, key, { contentType: input.mimeType, contentLength: input.sizeBytes, ttlSec: ttl });
    return { mediaAssetId: id, uploadUrl, expiresAt: new Date(now.getTime() + ttl * 1000), storageKey: key };
  }

  /**
   * Tạo asset NỘI DUNG từ bytes (seed/script, Sprint 4 – vd. ảnh SVG Part 1, audio Listening có sẵn): ghi bản gốc vào bucket media,
   * xử lý ĐỒNG BỘ (ffmpeg/SVG) và trả trạng thái cuối. Idempotent theo sha256 nội dung (`metadata.source_checksum`): cùng bytes →
   * dùng lại asset `ready`. `transcript` (audio): [{start_ms,end_ms,text,speaker}] – dùng cho Review Listening.
   */
  async createContentAsset(input: { kind: 'audio' | 'image'; mimeType: string; body: Buffer; license?: string; createdBy?: string | null; transcript?: Array<{ start_ms: number | null; end_ms: number | null; text: string; speaker: string | null }> | null }): Promise<{ mediaAssetId: string; status: string; reused: boolean; error: { code: string; message: string } | null }> {
    if (input.body.length === 0 || input.body.length > MAX_UPLOAD_BYTES) throw new Conflict('File size out of range', { size_bytes: input.body.length });
    const checksum = createHash('sha256').update(input.body).digest('hex');
    const [hit] = await this.dbs.db
      .select({ id: catalogMediaAssets.id, transcript: catalogMediaAssets.transcript })
      .from(catalogMediaAssets)
      .where(and(eq(catalogMediaAssets.kind, input.kind), eq(catalogMediaAssets.status, 'ready'), sql`${catalogMediaAssets.metadata}->>'source_checksum' = ${checksum}`))
      .limit(1);
    if (hit) {
      if (input.transcript !== undefined) await this.dbs.db.update(catalogMediaAssets).set({ transcript: input.transcript }).where(eq(catalogMediaAssets.id, hit.id));
      return { mediaAssetId: hit.id, status: 'ready', reused: true, error: null };
    }
    const id = randomUUID();
    const now = new Date();
    const mime = baseMime(input.mimeType);
    const key = `content/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}/original.${extForMime(mime)}`;
    await this.storage.putObject('media', key, input.body, { contentType: mime });
    const metadata: MediaMetadata = { bucket: 'media', origin: 'cms', original: { key, mime_type: mime, size_bytes: input.body.length }, source_checksum: checksum };
    await this.dbs.db.insert(catalogMediaAssets).values({ id, kind: input.kind, storageKey: key, mimeType: mime, sizeBytes: input.body.length, license: input.license ?? 'own', createdBy: input.createdBy ?? null, status: 'processing', metadata, transcript: input.transcript ?? null });
    await this.processor.process(id);
    const after = await this.getRow(id);
    const err = readMetadata(after.metadata).error ?? null;
    return { mediaAssetId: id, status: after.status, reused: false, error: err ? { code: err.code, message: err.message } : null };
  }

  async getRow(id: string): Promise<MediaAssetRow> {
    const row = await this.processor.load(id);
    if (!row) throw new NotFound('media_asset', id);
    return row;
  }

  /**
   * Yêu cầu xử lý sau khi tải lên xong: kiểm tra đối tượng tồn tại → status processing → job `media.process`
   * (jobId = asset id). Redis không sẵn sàng / enqueue lỗi → xử lý đồng bộ trong process (cảnh báo) để không kẹt.
   */
  async requestProcessing(id: string, opts: { force?: boolean } = {}): Promise<{ mediaAssetId: string; status: string; mode: ProcessRequestMode }> {
    const asset = await this.getRow(id);
    if (asset.kind !== 'audio' && asset.kind !== 'image') throw new Conflict('Only audio/image assets can be processed', { kind: asset.kind });
    const meta = readMetadata(asset.metadata);
    if (asset.status === 'ready' && !opts.force) return { mediaAssetId: id, status: 'ready', mode: 'noop' };
    const originalKey = meta.original?.key ?? asset.storageKey;
    const head = originalKey ? await this.storage.headObject(metadataBucket(meta), originalKey) : null;
    if (!head) throw new Conflict('Upload not found in storage – PUT the file to upload_url first', { media_asset_id: id, reason: 'upload_missing' });
    await this.dbs.db.update(catalogMediaAssets).set({ status: 'processing', metadata: { ...meta, error: null } }).where(eq(catalogMediaAssets.id, id));

    if (await this.enqueue(id)) return { mediaAssetId: id, status: 'processing', mode: 'queued' };
    this.logger.warn({ media_asset_id: id }, 'media.process inline (redis/queue unavailable – degraded mode)');
    const r = await this.processor.process(id, { force: opts.force });
    const after = await this.getRow(id);
    return { mediaAssetId: r.mediaAssetId, status: after.status, mode: 'inline' };
  }

  private async enqueue(id: string): Promise<boolean> {
    if (!this.redis.isHealthy) return false;
    try {
      return await withTimeout(
        (async () => {
          const q = this.queues.get(MEDIA_QUEUE);
          const existing = await q.getJob(id);
          if (existing) {
            const state = await existing.getState();
            // Job cũ đã xong/thất bại (giữ lại bởi removeOnComplete/Fail) → xoá để xử lý lại; đang chờ/chạy → giữ (idempotent)
            if (state === 'completed' || state === 'failed') await existing.remove();
            else return true;
          }
          await q.add(MEDIA_PROCESS_JOB, { media_asset_id: id }, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
          return true;
        })(),
        3000,
      );
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, media_asset_id: id }, 'media enqueue failed');
      return false;
    }
  }

  /** URL phát/xem (presignGet 10 phút, hoặc CDN công khai cho bucket media nếu cấu hình) */
  async view(id: string): Promise<MediaAssetView> {
    const a = await this.getRow(id);
    return this.toView(a);
  }

  async toView(a: MediaAssetRow): Promise<MediaAssetView> {
    const meta = readMetadata(a.metadata);
    const bucket = metadataBucket(meta);
    const ttl = this.storage.defaultTtlSec;
    const playable = a.status === 'ready' && !!a.storageKey;
    const url = playable ? await this.storage.presignGet(bucket, a.storageKey!, ttl) : a.externalUrl ?? null;
    const thumbnail_url = playable && meta.thumbnail_key ? await this.storage.presignGet(bucket, meta.thumbnail_key, ttl) : null;
    return {
      id: a.id,
      kind: a.kind,
      status: a.status,
      mime_type: a.mimeType ?? null,
      size_bytes: a.sizeBytes ?? null,
      duration_ms: a.durationMs ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
      url,
      thumbnail_url,
      url_expires_at: playable ? new Date(Date.now() + ttl * 1000).toISOString() : null,
      waveform: meta.waveform ?? null,
      error: meta.error ? { code: meta.error.code, message: meta.error.message } : null,
      created_at: a.createdAt.toISOString(),
      updated_at: a.updatedAt.toISOString(),
    };
  }

  /**
   * Asset audio `ready` cho một tệp TTS đã nằm trong bucket media. Cùng storage_key → dùng lại asset (idempotent).
   * Waveform tính ngay (tệp ngắn, ffmpeg nhanh); lỗi waveform không chặn.
   */
  async upsertTtsAsset(input: { storageKey: string; durationMs: number; sizeBytes: number; mime: string; text: string; tts: NonNullable<MediaMetadata['tts']>; createdBy?: string | null }): Promise<{ mediaAssetId: string; reused: boolean }> {
    const [existing] = await this.dbs.db.select({ id: catalogMediaAssets.id }).from(catalogMediaAssets).where(and(eq(catalogMediaAssets.storageKey, input.storageKey), eq(catalogMediaAssets.kind, 'audio'))).limit(1);
    if (existing) return { mediaAssetId: existing.id, reused: true };
    let waveform: MediaMetadata['waveform'] = null;
    if (ffmpegAvailable(this.processor.ffmpeg)) {
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'allingo-tts-'));
      try {
        const p = path.join(tmp, 'tts.mp3');
        await this.storage.downloadToFile('media', input.storageKey, p);
        const peaks = await computeWaveform(this.processor.ffmpeg, p, WAVEFORM_PEAKS, 'mp3');
        waveform = { count: peaks.length, sample_rate: WAVEFORM_SAMPLE_RATE, peaks };
      } catch (err) {
        this.logger.warn({ err: (err as Error).message }, 'tts waveform failed');
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    const id = randomUUID();
    const metadata: MediaMetadata = { bucket: 'media', origin: 'tts', tts: input.tts, waveform, processed_at: new Date().toISOString(), error: null };
    await this.dbs.db.insert(catalogMediaAssets).values({
      id,
      kind: 'audio',
      storageKey: input.storageKey,
      mimeType: input.mime,
      durationMs: input.durationMs,
      sizeBytes: input.sizeBytes,
      license: 'own',
      transcript: [{ start_ms: 0, end_ms: input.durationMs, text: input.text, speaker: null }],
      createdBy: input.createdBy ?? null,
      status: 'ready',
      metadata,
    });
    return { mediaAssetId: id, reused: false };
  }
}
