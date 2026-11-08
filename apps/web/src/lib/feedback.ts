import { ALLOWED_IMAGE_MIME, FEEDBACK_CATEGORIES, feedbackInputSchema, type FeedbackInput } from '@allingo/schemas';
import { env } from '@/env';

/**
 * Góp ý in-app (S12) – chuẩn hoá payload `POST /feedback` theo `feedbackInputSchema` (hợp đồng chung API ↔ web):
 *  - `page_url`: chỉ ĐƯỜNG DẪN trang (bỏ query/hash – có thể chứa token huỷ đăng ký, mã mời, email), bỏ tiền tố locale;
 *  - `trace_id`: trace gần nhất nếu đúng định dạng (sai → bỏ, server tự gắn trace của request góp ý);
 *  - `app_version`: bản phát hành web (Sentry release / git sha) – không gửi user agent (server tự đọc header, rút gọn);
 *  - không gửi email/tên/id người dùng (server biết người gửi qua phiên).
 * Ảnh màn hình: người học chọn tệp hoặc dán (Ctrl+V) – KHÔNG thư viện chụp màn hình; chỉ PNG/JPEG/WebP như `/uploads/presign`.
 */

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export { FEEDBACK_CATEGORIES };

/** Giới hạn ảnh phía web (API cho tới 20 MB – ảnh màn hình thường < 2 MB; chặn sớm tệp quá lớn trên mạng di động) */
export const FEEDBACK_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const FEEDBACK_MESSAGE_MAX = 4000;

export function feedbackPagePath(pathname: string | null | undefined): string | undefined {
  if (!pathname) return undefined;
  const path = pathname.split(/[?#]/)[0]!.replace(/^\/(vi|en)(?=\/|$)/, '') || '/';
  return path.slice(0, 1000);
}

/** Bản phát hành web (cùng giá trị release của Sentry – `allingo-web@<sha|version>`), ≤ 40 ký tự theo schema */
export function webAppVersion(release: string = env.sentryRelease): string {
  return (release || 'allingo-web').slice(0, 40);
}

export interface FeedbackDraft {
  category: FeedbackCategory;
  message: string;
  screenshotUploadId?: string | null;
}

export interface FeedbackContext {
  pathname: string | null | undefined;
  traceId: string | null | undefined;
  appVersion?: string;
}

/** Payload hợp lệ theo schema hoặc lỗi theo trường (`message_short` | `message_long` | `category`) */
export function buildFeedbackInput(draft: FeedbackDraft, ctx: FeedbackContext): { ok: true; input: FeedbackInput } | { ok: false; error: 'message_short' | 'message_long' | 'category' } {
  const message = draft.message.trim();
  if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(draft.category)) return { ok: false, error: 'category' };
  if (message.length < 3) return { ok: false, error: 'message_short' };
  if (message.length > FEEDBACK_MESSAGE_MAX) return { ok: false, error: 'message_long' };
  const trace = ctx.traceId && /^[A-Za-z0-9._-]{8,64}$/.test(ctx.traceId) ? ctx.traceId : undefined;
  const raw: FeedbackInput = {
    category: draft.category,
    message,
    page_url: feedbackPagePath(ctx.pathname),
    trace_id: trace,
    screenshot_upload_id: draft.screenshotUploadId ?? undefined,
    app_version: (ctx.appVersion ?? webAppVersion()).slice(0, 40),
  };
  // Bỏ khoá undefined (JSON gọn, khớp schema strict của server)
  const input = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as FeedbackInput;
  const parsed = feedbackInputSchema.safeParse(input);
  if (!parsed.success) {
    const { screenshot_upload_id: _s, ...rest } = input;
    const retry = feedbackInputSchema.safeParse(rest);
    if (!retry.success) return { ok: false, error: 'message_short' };
    return { ok: true, input: retry.data };
  }
  return { ok: true, input: parsed.data };
}

export type ImageCheck = 'ok' | 'type' | 'size' | 'empty';

export function checkScreenshot(file: { type: string; size: number }): ImageCheck {
  if (!file.size) return 'empty';
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type.toLowerCase())) return 'type';
  if (file.size > FEEDBACK_MAX_IMAGE_BYTES) return 'size';
  return 'ok';
}

/** Ảnh đầu tiên trong dữ liệu dán (Ctrl+V ảnh chụp màn hình từ clipboard) */
export function imageFromClipboard(data: Pick<DataTransfer, 'items'> | null | undefined): File | null {
  if (!data?.items) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
