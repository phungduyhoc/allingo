import { ApiError } from '@allingo/api-client';

/**
 * Feature flag phía web (S11, ADR-0034): đọc `GET /v1/flags` (công khai; có phiên → đánh giá theo người dùng), cache ≤ `ttl_sec`
 * (30 s) rồi làm mới. CHỈ dùng để ẩn/hiện giao diện – server luôn chặn bằng kill-switch (503 `feature_disabled`).
 * Module thuần (không React) để dùng ở server (SSR lần đầu), client và test.
 */

/** Khoá công khai – bản sao `PUBLIC_FLAG_KEYS` của API (`apps/api/src/modules/billing/feature-flags.service.ts`) */
export const PUBLIC_FLAG_KEYS = [
  'ff.ai.explain',
  'ff.ai.tutor',
  'ff.ai.diagnose',
  'ff.billing.checkout',
  'ff.growth.referral',
  'ff.learning.study_plan',
  'ff.catalog.program.ielts',
  'ff.catalog.program.jlpt',
  'ff.catalog.program.hsk',
] as const;
export type FlagKey = (typeof PUBLIC_FLAG_KEYS)[number];

/**
 * Giá trị khi chưa tải được cờ (API lỗi/ngoại tuyến, chưa có bản SSR): đúng `FLAG_FALLBACKS` của API – kill-switch mặc định BẬT
 * tính năng (gồm `ff.ai.diagnose` từ S12), chương trình chưa ra mắt mặc định tắt.
 */
export const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  'ff.ai.explain': true,
  'ff.ai.tutor': true,
  'ff.ai.diagnose': true,
  'ff.billing.checkout': true,
  'ff.growth.referral': true,
  'ff.learning.study_plan': true,
  'ff.catalog.program.ielts': false,
  'ff.catalog.program.jlpt': false,
  'ff.catalog.program.hsk': false,
};

export interface PublicFlags {
  flags: Partial<Record<string, boolean>>;
  /** Thời gian client được giữ bản này (giây) – API trả 30 */
  ttlSec: number;
  evaluatedAt: string | null;
}

/** TTL mặc định khi API không trả `ttl_sec` hợp lệ; chặn [5, 300] s để không dồn request / không giữ quá lâu */
export const DEFAULT_FLAGS_TTL_SEC = 30;
const clampTtl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(300, Math.max(5, Math.trunc(v))) : DEFAULT_FLAGS_TTL_SEC);

/** Đọc thân `GET /flags` (kiểm tra thủ công – không kéo Zod vào mọi trang); sai dạng → null */
export function parsePublicFlags(body: unknown): PublicFlags | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { flags?: unknown; ttl_sec?: unknown; evaluated_at?: unknown };
  if (!b.flags || typeof b.flags !== 'object' || Array.isArray(b.flags)) return null;
  const flags: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(b.flags as Record<string, unknown>)) if (typeof v === 'boolean' && /^ff\.[a-z0-9_.]+$/.test(k)) flags[k] = v;
  return { flags, ttlSec: clampTtl(b.ttl_sec), evaluatedAt: typeof b.evaluated_at === 'string' ? b.evaluated_at : null };
}

/** Giá trị cờ: có trong bản đã tải → theo server; chưa tải/không có khoá → mặc định (khoá lạ → tắt) */
export function isFlagOn(data: PublicFlags | null | undefined, key: string): boolean {
  const v = data?.flags[key];
  if (typeof v === 'boolean') return v;
  return (FLAG_DEFAULTS as Record<string, boolean>)[key] ?? false;
}

/** Tắt cờ ngay khi gặp 503 `feature_disabled` (ẩn UI trước khi lần làm mới `GET /flags` xong) */
export function markFlagDisabled(data: PublicFlags | null | undefined, key: string): PublicFlags {
  const base: PublicFlags = data ?? { flags: {}, ttlSec: DEFAULT_FLAGS_TTL_SEC, evaluatedAt: null };
  return { ...base, flags: { ...base.flags, [key]: false } };
}

/**
 * GET {apiUrl}/flags. `credentials: 'include'` để server đánh giá theo người dùng (rollout theo user/percent); ở server (SSR) gọi ẩn
 * danh, có hạn thời gian. Lỗi mạng/HTTP/sai dạng → ném lỗi (TanStack Query giữ bản cũ).
 */
export async function fetchPublicFlags(apiUrl: string, init: { fetch?: typeof fetch; signal?: AbortSignal; credentials?: RequestCredentials } = {}): Promise<PublicFlags> {
  const f = init.fetch ?? fetch;
  // `no-store`: không dùng cache HTTP (API trả `private, no-cache` từ S12; bản cũ `max-age=30` khiến lần tải lại ngay sau 503
  // kill-switch nhận cờ cũ) – nhịp ≥ 30 s do TanStack (staleTime/refetchInterval) quyết định
  const res = await f(`${apiUrl}/flags`, { method: 'GET', cache: 'no-store', credentials: init.credentials ?? 'include', headers: { Accept: 'application/json' }, signal: init.signal });
  if (!res.ok) throw new Error(`GET /flags ${res.status}`);
  const parsed = parsePublicFlags(await res.json());
  if (!parsed) throw new Error('GET /flags: invalid body');
  return parsed;
}

export interface FeatureDisabledInfo {
  flag: string;
  /** Khoá i18n server gợi ý (`errors.feature_disabled`) */
  messageKey: string;
  retryAfterSec: number | null;
}

/**
 * 503 `feature_disabled` CỦA KILL-SWITCH (có `details.flag`). Các 503 `feature_disabled` khác (push/OAuth/cổng thanh toán chưa cấu
 * hình – không có `flag`) → null để màn hình xử lý như cũ.
 */
export function parseFeatureDisabled(err: unknown): FeatureDisabledInfo | null {
  if (!(err instanceof ApiError) || err.code !== 'feature_disabled') return null;
  const flag = err.details?.flag;
  if (typeof flag !== 'string' || !flag.startsWith('ff.')) return null;
  const key = err.details?.message_key;
  const retry = err.details?.retry_after_sec;
  return {
    flag,
    messageKey: typeof key === 'string' && key.startsWith('errors.') ? key : 'errors.feature_disabled',
    retryAfterSec: typeof retry === 'number' && Number.isFinite(retry) && retry > 0 ? Math.trunc(retry) : null,
  };
}
