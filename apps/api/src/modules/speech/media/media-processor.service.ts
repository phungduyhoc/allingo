import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { schema } from '@allingo/db';
import { ENV, type Env } from '../../../config/env.js';
import { DbService } from '../../../shared/db/db.module.js';
import { MAX_UPLOAD_BYTES, StorageService, type Bucket } from '../../../shared/storage/storage.module.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { computeWaveform, convertImageToWebp, normalizeAudio, probeMedia, sniffMedia, WAVEFORM_SAMPLE_RATE, type FfmpegConfig, type ProbeResult, type SniffResult } from './ffmpeg.js';
import { inspectSvg, looksLikeSvg, MAX_SVG_BYTES } from './svg.js';
import {
  MAX_AUDIO_DURATION_MS,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
  MEDIA_PROCESS_JOB,
  MediaPermanentError,
  metadataBucket,
  readMetadata,
  THUMBNAIL_WIDTH,
  WAVEFORM_PEAKS,
  type MediaMetadata,
} from './media.types.js';

const { catalogMediaAssets } = schema;

export type MediaAssetRow = typeof catalogMediaAssets.$inferSelect;

export interface ProcessOutcome {
  mediaAssetId: string;
  status: 'ready' | 'failed' | 'missing' | 'skipped';
  code?: string;
}

export function ffmpegConfigFromEnv(env: Env): FfmpegConfig {
  return { ffmpegPath: env.FFMPEG_PATH, ffprobePath: env.FFPROBE_PATH, timeoutMs: env.MEDIA_FFMPEG_TIMEOUT_SECONDS * 1000 };
}

async function sha256File(p: string): Promise<string> {
  const h = createHash('sha256');
  for await (const c of fs.createReadStream(p)) h.update(c as Buffer);
  return h.digest('hex');
}

/**
 * Xử lý media (job `media.process`, ADR-0025): tải bản gốc → nhận dạng chữ ký → ffprobe →
 * audio: MP3 48 kbps mono + duration + waveform 200 đỉnh · ảnh: WebP + thumbnail 320 px (bỏ EXIF) →
 * cập nhật catalog.media_assets processing → ready | failed (+ metadata). Idempotent: asset đã ready thì bỏ qua.
 * SVG nội dung (Sprint 4): không qua ffmpeg – kiểm tra an toàn (`inspectSvg`) rồi phát nguyên bản `image.svg`; SVG trong tải lên của
 * người học / bucket recordings bị từ chối.
 */
@Injectable()
export class MediaProcessorService {
  private readonly logger = getLogger({ component: 'media.process' });
  readonly ffmpeg: FfmpegConfig;

  constructor(
    @Inject(ENV) env: Env,
    private readonly dbs: DbService,
    private readonly storage: StorageService,
  ) {
    this.ffmpeg = ffmpegConfigFromEnv(env);
  }

  /** Handler BullMQ: job.data = { media_asset_id } */
  async handleJob(job: Pick<Job, 'data' | 'attemptsMade' | 'opts'>): Promise<ProcessOutcome> {
    const id = String((job.data as { media_asset_id?: string }).media_asset_id ?? '');
    const maxAttempts = job.opts.attempts ?? 1;
    return this.process(id, { willRetry: job.attemptsMade + 1 < maxAttempts });
  }

  async load(id: string): Promise<MediaAssetRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await this.dbs.db.select().from(catalogMediaAssets).where(eq(catalogMediaAssets.id, id)).limit(1);
    return row ?? null;
  }

  private async update(id: string, patch: Partial<typeof catalogMediaAssets.$inferInsert>): Promise<void> {
    await this.dbs.db.update(catalogMediaAssets).set(patch).where(eq(catalogMediaAssets.id, id));
  }

  async process(id: string, opts: { force?: boolean; willRetry?: boolean } = {}): Promise<ProcessOutcome> {
    const asset = await this.load(id);
    if (!asset) return { mediaAssetId: id, status: 'missing' };
    const meta = readMetadata(asset.metadata);
    if (asset.status === 'ready' && meta.processed_at && !opts.force) return { mediaAssetId: id, status: 'skipped' };
    if (asset.status !== 'processing') await this.update(id, { status: 'processing' });

    const started = Date.now();
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'allingo-media-'));
    try {
      const bucket = metadataBucket(meta);
      const originalKey = meta.original?.key ?? asset.storageKey;
      if (!originalKey) throw new MediaPermanentError('not_processable', 'Asset has no storage key');
      if (asset.kind !== 'audio' && asset.kind !== 'image') throw new MediaPermanentError('not_processable', `Kind ${asset.kind} is not processed`);
      const head = await this.storage.headObject(bucket, originalKey);
      if (!head) throw new MediaPermanentError('upload_missing', 'Original object not found in storage');
      if (head.size > MAX_UPLOAD_BYTES) throw new MediaPermanentError('too_large', `Object exceeds ${MAX_UPLOAD_BYTES} bytes`);

      const inPath = path.join(tmp, 'original');
      await this.storage.downloadToFile(bucket, originalKey, inPath);
      const fh = await fsp.open(inPath, 'r');
      const headBuf = Buffer.alloc(64);
      await fh.read(headBuf, 0, 64, 0);
      await fh.close();
      const sniff = sniffMedia(headBuf);
      if (!sniff && looksLikeSvg(headBuf)) {
        if (asset.kind !== 'image') throw new MediaPermanentError('kind_mismatch', `File is image, asset is ${asset.kind}`);
        if (bucket !== 'media' || meta.origin === 'learner_upload') throw new MediaPermanentError('unsupported_media', 'SVG is only accepted for content images');
        if (head.size > MAX_SVG_BYTES) throw new MediaPermanentError('too_large', `SVG exceeds ${MAX_SVG_BYTES} bytes`);
        await this.processSvg(asset, meta, { bucket, dir: path.posix.dirname(originalKey), inPath, originalKey, size: head.size, started });
        this.logger.info({ media_asset_id: id, kind: 'image', format: 'svg', ms: Date.now() - started }, 'media processed');
        return { mediaAssetId: id, status: 'ready' };
      }
      if (!sniff) throw new MediaPermanentError('unsupported_media', 'Unrecognised file signature');
      if (sniff.kind !== asset.kind) throw new MediaPermanentError('kind_mismatch', `File is ${sniff.kind}, asset is ${asset.kind}`);
      let probe: ProbeResult;
      try {
        probe = await probeMedia(this.ffmpeg, inPath, sniff.demuxer);
      } catch {
        throw new MediaPermanentError('unsupported_media', 'File could not be decoded');
      }
      const original = { key: originalKey, mime_type: asset.mimeType ?? sniff.mime, size_bytes: head.size, container: sniff.container, duration_ms: probe.durationMs };
      const dir = path.posix.dirname(originalKey);

      if (asset.kind === 'audio') await this.processAudio(asset, meta, { bucket, dir, inPath, tmp, sniff, probe, original, started });
      else await this.processImage(asset, meta, { bucket, dir, inPath, tmp, sniff, probe, original, started });
      this.logger.info({ media_asset_id: id, kind: asset.kind, ms: Date.now() - started }, 'media processed');
      return { mediaAssetId: id, status: 'ready' };
    } catch (err) {
      const permanent = err instanceof MediaPermanentError;
      const code = permanent ? err.code : 'processing_error';
      // Không đưa stderr/đường dẫn vào DB/log: chỉ mã + thông điệp ngắn
      const message = permanent ? err.message : 'Media processing failed';
      await this.update(id, { status: 'failed', metadata: { ...meta, error: { code, message, retrying: !permanent && !!opts.willRetry, at: new Date().toISOString() } } }).catch(() => undefined);
      this.logger.warn({ media_asset_id: id, code, err: permanent ? undefined : (err as Error).message.slice(0, 200) }, 'media processing failed');
      if (!permanent && opts.willRetry) throw err;
      return { mediaAssetId: id, status: 'failed', code };
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async processAudio(asset: MediaAssetRow, meta: MediaMetadata, ctx: Ctx): Promise<void> {
    if (!ctx.probe.streams.some((s) => s.codecType === 'audio')) throw new MediaPermanentError('no_audio_stream', 'No audio stream');
    if ((ctx.probe.durationMs ?? 0) > MAX_AUDIO_DURATION_MS) throw new MediaPermanentError('duration_too_long', 'Audio too long');
    const outPath = path.join(ctx.tmp, 'audio.mp3');
    await normalizeAudio(this.ffmpeg, ctx.inPath, ctx.sniff.demuxer, outPath);
    const outProbe = await probeMedia(this.ffmpeg, outPath, 'mp3');
    const peaks = await computeWaveform(this.ffmpeg, outPath, WAVEFORM_PEAKS, 'mp3');
    const size = (await fsp.stat(outPath)).size;
    const key = `${ctx.dir}/audio.mp3`;
    await this.storage.putFile(ctx.bucket, key, outPath, { contentType: 'audio/mpeg', cacheControl: ctx.bucket === 'media' ? 'public, max-age=31536000, immutable' : 'private, no-store' });
    await this.update(asset.id, {
      status: 'ready',
      storageKey: key,
      mimeType: 'audio/mpeg',
      sizeBytes: size,
      durationMs: outProbe.durationMs ?? ctx.probe.durationMs,
      checksum: await sha256File(outPath),
      metadata: {
        ...meta,
        bucket: ctx.bucket,
        original: ctx.original,
        variants: { ...(meta.variants ?? {}), mp3_48k: { key, mime_type: 'audio/mpeg', size_bytes: size, bitrate_kbps: 48 } },
        waveform: { count: peaks.length, sample_rate: WAVEFORM_SAMPLE_RATE, peaks },
        processed_at: new Date().toISOString(),
        processing_ms: Date.now() - ctx.started,
        error: null,
      },
    });
  }

  /** SVG nội dung: kiểm tra an toàn, giữ nguyên tệp (vector, không cần thumbnail), Content-Type image/svg+xml */
  private async processSvg(asset: MediaAssetRow, meta: MediaMetadata, ctx: { bucket: Bucket; dir: string; inPath: string; originalKey: string; size: number; started: number }): Promise<void> {
    const body = await fsp.readFile(ctx.inPath);
    const check = inspectSvg(body);
    if (!check.ok) throw new MediaPermanentError('unsupported_media', check.reason ?? 'Unsafe SVG');
    const key = `${ctx.dir}/image.svg`;
    await this.storage.putObject(ctx.bucket, key, body, { contentType: 'image/svg+xml', cacheControl: 'public, max-age=31536000, immutable' });
    await this.update(asset.id, {
      status: 'ready',
      storageKey: key,
      mimeType: 'image/svg+xml',
      sizeBytes: body.length,
      width: check.width,
      height: check.height,
      checksum: createHash('sha256').update(body).digest('hex'),
      metadata: {
        ...meta,
        bucket: ctx.bucket,
        original: { key: ctx.originalKey, mime_type: 'image/svg+xml', size_bytes: ctx.size, container: 'svg', duration_ms: null },
        variants: { ...(meta.variants ?? {}), svg: { key, mime_type: 'image/svg+xml', size_bytes: body.length, width: check.width, height: check.height } },
        thumbnail_key: null,
        processed_at: new Date().toISOString(),
        processing_ms: Date.now() - ctx.started,
        error: null,
      },
    });
  }

  private async processImage(asset: MediaAssetRow, meta: MediaMetadata, ctx: Ctx): Promise<void> {
    const v = ctx.probe.streams.find((s) => s.codecType === 'video' && s.width && s.height);
    if (!v) throw new MediaPermanentError('no_image_stream', 'No image stream');
    if (v.width! > MAX_IMAGE_SIDE || v.height! > MAX_IMAGE_SIDE || v.width! * v.height! > MAX_IMAGE_PIXELS) throw new MediaPermanentError('image_too_large', 'Image dimensions too large');
    const webpPath = path.join(ctx.tmp, 'image.webp');
    const thumbPath = path.join(ctx.tmp, 'thumb.webp');
    await convertImageToWebp(this.ffmpeg, ctx.inPath, ctx.sniff.demuxer, webpPath);
    await convertImageToWebp(this.ffmpeg, ctx.inPath, ctx.sniff.demuxer, thumbPath, THUMBNAIL_WIDTH);
    const [mainProbe, thumbProbe] = await Promise.all([probeMedia(this.ffmpeg, webpPath, 'webp_pipe'), probeMedia(this.ffmpeg, thumbPath, 'webp_pipe')]);
    const dim = (p: ProbeResult) => p.streams.find((s) => s.codecType === 'video') ?? { width: null, height: null };
    const [mainSize, thumbSize] = await Promise.all([fsp.stat(webpPath).then((s) => s.size), fsp.stat(thumbPath).then((s) => s.size)]);
    const key = `${ctx.dir}/image.webp`;
    const thumbKey = `${ctx.dir}/thumb.webp`;
    const cacheControl = ctx.bucket === 'media' ? 'public, max-age=31536000, immutable' : 'private, no-store';
    await this.storage.putFile(ctx.bucket, key, webpPath, { contentType: 'image/webp', cacheControl });
    await this.storage.putFile(ctx.bucket, thumbKey, thumbPath, { contentType: 'image/webp', cacheControl });
    await this.update(asset.id, {
      status: 'ready',
      storageKey: key,
      mimeType: 'image/webp',
      sizeBytes: mainSize,
      width: dim(mainProbe).width ?? v.width,
      height: dim(mainProbe).height ?? v.height,
      checksum: await sha256File(webpPath),
      metadata: {
        ...meta,
        bucket: ctx.bucket,
        original: ctx.original,
        variants: {
          ...(meta.variants ?? {}),
          webp: { key, mime_type: 'image/webp', size_bytes: mainSize, width: dim(mainProbe).width, height: dim(mainProbe).height },
          thumbnail: { key: thumbKey, mime_type: 'image/webp', size_bytes: thumbSize, width: dim(thumbProbe).width, height: dim(thumbProbe).height },
        },
        thumbnail_key: thumbKey,
        processed_at: new Date().toISOString(),
        processing_ms: Date.now() - ctx.started,
        error: null,
      },
    });
  }
}

interface Ctx {
  bucket: Bucket;
  dir: string;
  inPath: string;
  tmp: string;
  sniff: SniffResult;
  probe: ProbeResult;
  original: NonNullable<MediaMetadata['original']>;
  started: number;
}

/** Bảng handler cho WorkerRunner (queue `media`) */
export function mediaJobHandlers(processor: MediaProcessorService): Record<string, (job: Job) => Promise<unknown>> {
  return { [MEDIA_PROCESS_JOB]: (job: Job) => processor.handleJob(job) };
}
