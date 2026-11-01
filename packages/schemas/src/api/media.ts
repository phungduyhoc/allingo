import { z } from 'zod';

/**
 * Hợp đồng tải lên trực tiếp (OpenAPI `/uploads/presign`, ADR-0025) – dùng chung API, web, mobile.
 * URL PUT ký cả Content-Type và Content-Length: client phải gửi đúng `mime_type` và `size_bytes` đã khai báo.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_RECORDING_DURATION_MS = 30 * 60 * 1000;
export const ALLOWED_AUDIO_MIME = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'] as const;
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const SVG_MIME = 'image/svg+xml' as const;
/**
 * Ảnh NỘI DUNG (CMS/seed, bucket media – Sprint 4: ảnh minh hoạ Part 1 dạng SVG tự vẽ): thêm `image/svg+xml`.
 * SVG được kiểm tra không chứa nội dung chủ động (script, sự kiện, tham chiếu ngoài) khi xử lý. Người học KHÔNG được tải SVG lên
 * (`uploadPresignSchema` vẫn dùng ALLOWED_IMAGE_MIME).
 */
export const CONTENT_IMAGE_MIME = [...ALLOWED_IMAGE_MIME, SVG_MIME] as const;

/** MIME gốc, bỏ tham số (`audio/webm;codecs=opus` → `audio/webm`) */
export function baseMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase();
}

export function isAllowedMime(kind: 'audio' | 'image', mime: string): boolean {
  const allowed: readonly string[] = kind === 'audio' ? ALLOWED_AUDIO_MIME : ALLOWED_IMAGE_MIME;
  return allowed.includes(baseMime(mime));
}

export const uploadPresignSchema = z
  .object({
    kind: z.enum(['recording', 'image']),
    mime_type: z.string().min(3).max(100),
    size_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    duration_ms: z.number().int().positive().max(MAX_RECORDING_DURATION_MS).optional(),
  })
  .superRefine((v, ctx) => {
    const kind = v.kind === 'recording' ? 'audio' : 'image';
    if (!isAllowedMime(kind, v.mime_type)) {
      const allowed = kind === 'audio' ? ALLOWED_AUDIO_MIME : ALLOWED_IMAGE_MIME;
      ctx.addIssue({ code: 'custom', path: ['mime_type'], message: `mime_type must be one of ${allowed.join(', ')}` });
    }
  });
export type UploadPresign = z.infer<typeof uploadPresignSchema>;

export const uploadPresignResponseSchema = z.object({ upload_url: z.string(), resource_id: z.uuid(), expires_at: z.iso.datetime() });
export type UploadPresignResponse = z.infer<typeof uploadPresignResponseSchema>;
