import { ApiError } from '@allingo/api-client';

/**
 * Beta kín (S12, ADR-0035) – logic thuần phía web:
 *  - 403 `beta_required` từ bất kỳ endpoint app → sự kiện `allingo:beta-required` → listener trong layout (app) chuyển tới `/beta`
 *    (trừ các trang được miễn: hỗ trợ, cài đặt tài khoản/bảo mật – API cũng miễn các endpoint tương ứng, A194).
 *  - Mã mời `ALG-XXXX-XXXX`: định dạng lúc gõ + chuẩn hoá giống API (`normalizeInviteCode` của growth/beta-rules.ts).
 *  - Lỗi đổi mã → khoá i18n `beta.redeemErrors.*` theo `details.reason` (server quyết định – web chỉ hiển thị).
 * Server luôn là nơi kiểm tra quyền (CLAUDE.md §5.7) – web chỉ điều hướng/ẩn hiện.
 */

export const BETA_REQUIRED_EVENT = 'allingo:beta-required';

/** 403 `beta_required`? */
export function isBetaRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code === 'beta_required';
}

/** Phát sự kiện toàn cục khi gặp `beta_required` (gọi từ notifyApiError – QueryCache/MutationCache) */
export function notifyBetaRequired(err: unknown): boolean {
  if (!isBetaRequired(err)) return false;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BETA_REQUIRED_EVENT));
  return true;
}

/**
 * Trang khu vực học KHÔNG tự chuyển tới /beta khi gặp 403 (API miễn beta gate cho hỗ trợ, hồ sơ/xoá dữ liệu, MFA, phiên):
 * người chưa có mã vẫn liên hệ hỗ trợ, xoá tài khoản, bật MFA được. Đường dẫn KHÔNG kèm tiền tố locale.
 */
const EXEMPT_PREFIXES = ['/beta', '/support', '/settings', '/onboarding/beta'];
export function isBetaExemptPath(pathname: string): boolean {
  const p = pathname.replace(/^\/(vi|en)(?=\/|$)/, '') || '/';
  return EXEMPT_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}

/** Đường dẫn quay lại sau khi đổi mã: chỉ đường dẫn nội bộ (chặn `//host`, `javascript:`), bỏ locale; mặc định dashboard */
export function betaNextPath(raw: string | null | undefined, fallback = '/toeic/dashboard'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  const p = raw.replace(/^\/(vi|en)(?=\/|$)/, '') || '/';
  if (p === '/' || p.startsWith('/beta')) return fallback;
  return p;
}

/** Bảng chữ mã mời của API (bỏ 0/O, 1/I/L) – chỉ dùng để báo ký tự không hợp lệ, server vẫn kiểm tra */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Chuẩn hoá như API: viết hoa, bỏ ký tự không phải chữ/số, thêm tiền tố ALG khi thiếu (`ALGABCD2345`) */
export function normalizeInviteCode(code: string): string {
  const s = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.startsWith('ALG') ? s : `ALG${s}`;
}

/**
 * Định dạng hiển thị khi gõ/dán: `alg abcd2345` → `ALG-ABCD-2345`; gõ thiếu tiền tố (`abcd-2345`) vẫn hiển thị có `ALG-`.
 * Chuỗi rỗng giữ rỗng (để placeholder hiện). Tối đa 8 ký tự sau tiền tố.
 */
export function formatInviteCodeInput(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  // Đang gõ dần tiền tố "A", "AL" → giữ nguyên để không nhảy chữ
  if ('ALG'.startsWith(s) && s.length < 3) return s;
  const body = (s.startsWith('ALG') ? s.slice(3) : s).slice(0, 8);
  if (!body) return 'ALG-';
  return body.length <= 4 ? `ALG-${body}` : `ALG-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** Đủ 8 ký tự sau tiền tố (cho phép bấm "Kích hoạt") */
export function isCompleteInviteCode(code: string): boolean {
  return /^ALG[A-Z0-9]{8}$/.test(normalizeInviteCode(code));
}

/** Ký tự không có trong bảng chữ mã mời (gợi ý: 0→O? 1→I?) – hiển thị nhắc nhẹ, không chặn gửi */
export function hasAmbiguousChars(code: string): boolean {
  const body = normalizeInviteCode(code).slice(3);
  return [...body].some((c) => !INVITE_ALPHABET.includes(c));
}

export type RedeemErrorKey = 'invalid' | 'used' | 'alreadyBeta' | 'guest' | 'rateLimited' | 'network' | 'generic';

/**
 * Lỗi `POST /beta/redeem` → khoá i18n: 400 `invite_invalid` (sai/hết hạn/đã thu hồi – API gộp để chống dò mã), 409 `invite_used`
 * (người khác đã dùng), 409 `already_beta` (tài khoản đã đổi mã khác), 403 khách (`guest_not_allowed`), 429 bucket `beta_redeem`.
 */
export function redeemErrorKey(err: unknown): RedeemErrorKey {
  if (err instanceof TypeError) return 'network';
  if (!(err instanceof ApiError)) return 'generic';
  const reason = typeof err.details?.reason === 'string' ? err.details.reason : null;
  if (err.status === 429) return 'rateLimited';
  if (err.status === 403) return 'guest';
  if (reason === 'invite_used') return 'used';
  if (reason === 'already_beta') return 'alreadyBeta';
  if (reason === 'invite_invalid' || err.status === 400) return 'invalid';
  return 'generic';
}
