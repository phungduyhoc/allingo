import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, isNotNull, lt, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { PROGRAM_CODES } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import type { AuthUser } from '../../shared/auth/auth.guard.js';
import { baseMime, StorageService } from '../../shared/storage/storage.module.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { EntitlementService } from '../billing/index.js';
import { MediaAssetsService } from '../speech/index.js';

const { learnRecordings } = schema;

/** Vòng đời ghi âm theo gói (CLAUDE.md §9): Free 90 ngày, Pro 365 ngày */
export const RECORDING_RETENTION_DAYS = { free: 90, pro: 365 } as const;

const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav' };

export interface PresignInput {
  kind: 'recording' | 'image';
  mime_type: string;
  size_bytes: number;
  duration_ms?: number;
}

export interface PresignOutput {
  upload_url: string;
  resource_id: string;
  expires_at: string;
}

/**
 * Tải lên trực tiếp của người học (PUT có hạn 10 phút):
 * - recording → learn.recordings (bucket recordings, expires_at theo gói);
 * - image (ảnh biểu đồ/bài viết tay) → catalog.media_assets status `uploading`, bucket recordings (dữ liệu cá nhân).
 */
@Injectable()
export class UploadsService {
  private readonly logger = getLogger({ component: 'grading.uploads' });

  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
    private readonly entitlements: EntitlementService,
    private readonly media: MediaAssetsService,
  ) {}

  /** Pro ở bất kỳ chương trình nào → 365 ngày (entitlement không gắn chương trình áp cho mọi chương trình) */
  async retentionDays(user: AuthUser): Promise<number> {
    if (user.isGuest) return RECORDING_RETENTION_DAYS.free;
    try {
      for (const program of PROGRAM_CODES) {
        const ctx = await this.entitlements.getContext(user.id, program);
        if (ctx.isPro) return RECORDING_RETENTION_DAYS.pro;
      }
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'entitlement lookup failed – default free retention');
    }
    return RECORDING_RETENTION_DAYS.free;
  }

  async presign(user: AuthUser, input: PresignInput): Promise<PresignOutput> {
    const mime = baseMime(input.mime_type);
    if (input.kind === 'image') {
      const r = await this.media.createUpload({ kind: 'image', mimeType: input.mime_type, sizeBytes: input.size_bytes, origin: 'learner_upload', bucket: 'recordings', createdBy: user.id });
      return { upload_url: r.uploadUrl, resource_id: r.mediaAssetId, expires_at: r.expiresAt.toISOString() };
    }
    const id = randomUUID();
    const now = new Date();
    const days = await this.retentionDays(user);
    const key = `rec/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${EXT[mime] ?? 'bin'}`;
    await this.dbs.db.insert(learnRecordings).values({
      id,
      userId: user.id,
      storageKey: key,
      mimeType: mime,
      durationMs: input.duration_ms ?? null,
      sizeBytes: input.size_bytes,
      expiresAt: new Date(now.getTime() + days * 86_400_000),
    });
    const ttl = this.storage.defaultTtlSec;
    const upload_url = await this.storage.presignPut('recordings', key, { contentType: input.mime_type, contentLength: input.size_bytes, ttlSec: ttl });
    return { upload_url, resource_id: id, expires_at: new Date(now.getTime() + ttl * 1000).toISOString() };
  }

  /**
   * S12 – ops.retention_cleanup: ghi âm quá `expires_at` (90/365 ngày theo gói – CLAUDE.md §9) → xoá đối tượng S3 rồi xoá hàng;
   * hàng còn được learn.submissions tham chiếu thì giữ hàng (FK) nhưng xoá tệp + transcript, đánh dấu storage_key `purged/<id>`.
   */
  async purgeExpiredRecordings(now: Date, batch: number): Promise<{ deleted: number; purged_files: number; kept_rows: number }> {
    const rows = await this.dbs.db
      .select({ id: learnRecordings.id, key: learnRecordings.storageKey })
      .from(learnRecordings)
      .where(and(isNotNull(learnRecordings.expiresAt), lt(learnRecordings.expiresAt, now)))
      .limit(batch);
    let purged = 0;
    let deleted = 0;
    let kept = 0;
    for (const r of rows) {
      if (!r.key.startsWith('purged/')) {
        if (await this.storage.deleteObject('recordings', r.key)) purged++;
      }
      const res = (await this.dbs.db.execute(sql`delete from learn.recordings where id = ${r.id} and not exists (select 1 from learn.submissions s where s.recording_id = ${r.id}) returning id`)) as unknown as unknown[];
      if (res.length) deleted++;
      else {
        kept++;
        await this.dbs.db.execute(sql`update learn.recordings set storage_key = ${`purged/${r.id}`}, transcript = null, expires_at = null where id = ${r.id}`);
      }
    }
    if (rows.length) this.logger.info({ deleted, purged_files: purged, kept_rows: kept }, 'expired recordings purged');
    return { deleted, purged_files: purged, kept_rows: kept };
  }
}
