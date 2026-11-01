import { z } from 'zod';
import type { Bucket } from '../../../shared/storage/storage.module.js';

/** Job BullMQ hàng đợi `media` (jobId = media_asset_id → idempotent) */
export const MEDIA_QUEUE = 'media' as const;
export const MEDIA_PROCESS_JOB = 'media.process';

export const WAVEFORM_PEAKS = 200;
export const THUMBNAIL_WIDTH = 320;
/** Giới hạn an toàn khi xử lý (chống "bom" giải nén) */
export const MAX_AUDIO_DURATION_MS = 3 * 3600 * 1000;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_IMAGE_SIDE = 12_000;

/** MIME cho phép tải lên trực tiếp (OpenAPI /uploads/presign + API nội bộ CMS) */
export { ALLOWED_AUDIO_MIME, ALLOWED_IMAGE_MIME } from '@allingo/schemas';

const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function extForMime(mime: string): string {
  return EXT[mime] ?? 'bin';
}

export type MediaOrigin = 'cms' | 'learner_upload' | 'tts';

export interface MediaVariant {
  key: string;
  mime_type: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  bitrate_kbps?: number;
}

/**
 * Cấu trúc `catalog.media_assets.metadata` (v1.1 – Sprint 2). Khai báo cục bộ trong module speech;
 * chuyển sang packages/schemas khi web/CMS cần đọc (ghi chú bàn giao).
 */
export const mediaMetadataSchema = z
  .object({
    bucket: z.enum(['media', 'recordings']).optional(),
    origin: z.enum(['cms', 'learner_upload', 'tts']).optional(),
    original: z.object({ key: z.string(), mime_type: z.string(), size_bytes: z.number().int().nullable().optional(), container: z.string().optional(), duration_ms: z.number().int().nullable().optional() }).optional(),
    variants: z.record(z.string(), z.object({ key: z.string(), mime_type: z.string(), size_bytes: z.number().int(), width: z.number().int().nullable().optional(), height: z.number().int().nullable().optional(), bitrate_kbps: z.number().optional() })).optional(),
    waveform: z.object({ count: z.number().int(), sample_rate: z.number().int(), peaks: z.array(z.number()) }).nullable().optional(),
    thumbnail_key: z.string().nullable().optional(),
    tts: z.object({ voice: z.string(), locale: z.string(), provider: z.string(), text_hash: z.string() }).optional(),
    processed_at: z.string().nullable().optional(),
    /** Đã xoá tệp do chủ tài khoản bị xoá (PersonalDataRegistry) */
    purged_at: z.string().optional(),
    processing_ms: z.number().int().nullable().optional(),
    error: z.object({ code: z.string(), message: z.string(), retrying: z.boolean().optional(), at: z.string().optional() }).nullable().optional(),
  })
  .loose();

export type MediaMetadata = z.infer<typeof mediaMetadataSchema>;

export function readMetadata(raw: unknown): MediaMetadata {
  const r = mediaMetadataSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

export function metadataBucket(meta: MediaMetadata): Bucket {
  return meta.bucket ?? 'media';
}

/** Lỗi xử lý vĩnh viễn (định dạng sai, quá lớn…) – không retry */
export class MediaPermanentError extends Error {
  constructor(
    readonly code: 'upload_missing' | 'too_large' | 'unsupported_media' | 'kind_mismatch' | 'no_audio_stream' | 'no_image_stream' | 'duration_too_long' | 'image_too_large' | 'not_processable',
    message: string,
  ) {
    super(message);
    this.name = 'MediaPermanentError';
  }
}
