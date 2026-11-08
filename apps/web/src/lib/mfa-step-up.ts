import { ApiError } from '@allingo/api-client';

/**
 * MFA step-up cho admin (S12, ADR-0035 §5, SPEC-ISSUES S134): endpoint quản trị (`@Roles`) trả 403 `mfa_required` khi phiên chưa
 * xác minh TOTP (`ADMIN_MFA_REQUIRED` – bật ở staging/production). Web không đổi luồng đăng nhập: middleware của API client giữ
 * bản sao request `/admin/*`, gặp 403 `mfa_required` → hỏi trình xử lý step-up (hộp thoại nhập mã trong layout (app)) → xác minh
 * thành công (`POST /auth/mfa/verify` đặt lại cookie có claim `mfa`) → GỬI LẠI đúng request đó một lần. Huỷ/không có trình xử lý →
 * trả nguyên 403 cho màn hình (ErrorState `errors.codes.mfa_required`). Nhiều request lỗi cùng lúc dùng chung MỘT lần hỏi.
 */

export interface MfaRequiredInfo {
  /** `details.enrolled` (false → phải đăng ký TOTP trước) – API gửi từ B7/S144; null = API cũ không gửi (web tra /me/mfa dự phòng) */
  enrolled: boolean | null;
  reason: string | null;
}

type ErrorBody = { error?: { code?: string; details?: Record<string, unknown> } };

export function parseMfaRequiredBody(status: number, body: unknown): MfaRequiredInfo | null {
  const err = (body as ErrorBody | null)?.error;
  if (status !== 403 || err?.code !== 'mfa_required') return null;
  const d = err.details ?? {};
  return { enrolled: typeof d.enrolled === 'boolean' ? d.enrolled : null, reason: typeof d.reason === 'string' ? d.reason : null };
}

export function parseMfaRequired(err: unknown): MfaRequiredInfo | null {
  if (!(err instanceof ApiError)) return null;
  return parseMfaRequiredBody(err.status, { error: { code: err.code, details: err.details } });
}

export type StepUpHandler = (info: MfaRequiredInfo) => Promise<boolean>;

let handler: StepUpHandler | null = null;
let pending: Promise<boolean> | null = null;

/** Đăng ký trình xử lý (hộp thoại) – trả hàm huỷ đăng ký */
export function setStepUpHandler(h: StepUpHandler | null): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/** Hỏi step-up; request song song chờ cùng một lời hỏi. Không có trình xử lý → false (không gửi lại) */
export function requestStepUp(info: MfaRequiredInfo): Promise<boolean> {
  if (!handler) return Promise.resolve(false);
  if (pending) return pending;
  const h = handler;
  pending = h(info)
    .catch(() => false)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Chỉ dùng trong test */
export function resetStepUpForTest(): void {
  handler = null;
  pending = null;
}

/** Request cần giữ bản sao để có thể gửi lại: endpoint quản trị (`/admin/...`), trừ chính luồng `/auth/*` */
export function isStepUpCandidate(url: string): boolean {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* đường dẫn tương đối */
  }
  return /\/admin(\/|$)/.test(path) && !/\/auth\//.test(path);
}

/** Middleware openapi-fetch (kiểu tối giản để không phụ thuộc phiên bản) */
export interface StepUpMiddleware {
  onRequest: (o: { request: Request; id: string }) => undefined;
  onResponse: (o: { request: Request; response: Response; id: string }) => Promise<Response | undefined>;
  onError: (o: { id: string }) => undefined;
}

export function createMfaStepUpMiddleware(opts: { fetch: (req: Request) => Promise<Response>; ask?: (info: MfaRequiredInfo) => Promise<boolean> }): StepUpMiddleware {
  const copies = new Map<string, Request>();
  const ask = opts.ask ?? requestStepUp;
  return {
    onRequest({ request, id }) {
      // Bản sao trước khi fetch dùng mất thân request (POST/PATCH có body)
      if (isStepUpCandidate(request.url)) copies.set(id, request.clone());
      return undefined;
    },
    async onResponse({ response, id }) {
      const copy = copies.get(id);
      copies.delete(id);
      if (!copy || response.status !== 403) return undefined;
      let body: unknown = null;
      try {
        body = await response.clone().json();
      } catch {
        return undefined;
      }
      const info = parseMfaRequiredBody(response.status, body);
      if (!info) return undefined;
      const ok = await ask(info);
      if (!ok) return undefined;
      return opts.fetch(copy);
    },
    onError({ id }) {
      copies.delete(id);
      return undefined;
    },
  };
}
