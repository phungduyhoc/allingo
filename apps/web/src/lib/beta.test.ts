import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@allingo/api-client';
import { BETA_REQUIRED_EVENT, betaNextPath, formatInviteCodeInput, hasAmbiguousChars, isBetaExemptPath, isBetaRequired, isCompleteInviteCode, normalizeInviteCode, notifyBetaRequired, redeemErrorKey } from './beta';
import { notifyApiError } from './api-error-events';

const err = (status: number, code: string, details?: Record<string, unknown>) => new ApiError(status, { error: { code, message: code, details } });
const beta = () => err(403, 'beta_required', { message_key: 'errors.beta_required', redeem_path: '/beta/redeem' });

describe('beta gate – 403 beta_required (S12)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('nhận đúng 403 beta_required, bỏ qua 403 khác', () => {
    expect(isBetaRequired(beta())).toBe(true);
    expect(isBetaRequired(err(403, 'forbidden'))).toBe(false);
    expect(isBetaRequired(err(403, 'exam_mode_locked'))).toBe(false);
    expect(isBetaRequired(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('notifyApiError (QueryCache/MutationCache) phát đúng một sự kiện allingo:beta-required', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const seen = vi.fn();
    target.addEventListener(BETA_REQUIRED_EVENT, seen);
    notifyApiError(beta());
    notifyApiError(err(403, 'forbidden'));
    notifyApiError(err(429, 'rate_limited', { retry_after_sec: 3 }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(notifyBetaRequired(err(401, 'unauthorized'))).toBe(false);
  });

  it('trang được miễn chuyển hướng: hỗ trợ, cài đặt, chính /beta, onboarding beta (có/không tiền tố locale)', () => {
    for (const p of ['/support', '/support/tickets/abc', '/settings', '/settings/security', '/beta', '/vi/beta', '/en/support', '/onboarding/beta']) expect(isBetaExemptPath(p), p).toBe(true);
    for (const p of ['/toeic/dashboard', '/vi/toeic/practice', '/attempts/1', '/onboarding', '/supportx', '/betax']) expect(isBetaExemptPath(p), p).toBe(false);
  });

  it('`next` chỉ nhận đường dẫn nội bộ, bỏ locale, không quay lại /beta', () => {
    expect(betaNextPath('/vi/toeic/practice?section=part5')).toBe('/toeic/practice?section=part5');
    expect(betaNextPath('/attempts/1/review')).toBe('/attempts/1/review');
    expect(betaNextPath('//evil.example')).toBe('/toeic/dashboard');
    expect(betaNextPath('https://evil.example')).toBe('/toeic/dashboard');
    expect(betaNextPath('/beta?code=x')).toBe('/toeic/dashboard');
    expect(betaNextPath(null)).toBe('/toeic/dashboard');
  });
});

describe('mã mời ALG-XXXX-XXXX', () => {
  it('chuẩn hoá như API: hoa, bỏ gạch/khoảng trắng, thêm tiền tố', () => {
    expect(normalizeInviteCode('alg-abcd-2345')).toBe('ALGABCD2345');
    expect(normalizeInviteCode(' ABCD 2345 ')).toBe('ALGABCD2345');
    expect(normalizeInviteCode('ALG ABCD-2345')).toBe('ALGABCD2345');
  });

  it('định dạng khi gõ dần và khi dán', () => {
    const typed: string[] = [];
    let v = '';
    for (const ch of 'algabcd2345') {
      v = formatInviteCodeInput(v + ch);
      typed.push(v);
    }
    expect(typed).toEqual(['A', 'AL', 'ALG-', 'ALG-A', 'ALG-AB', 'ALG-ABC', 'ALG-ABCD', 'ALG-ABCD-2', 'ALG-ABCD-23', 'ALG-ABCD-234', 'ALG-ABCD-2345']);
    expect(formatInviteCodeInput('abcd2345')).toBe('ALG-ABCD-2345');
    expect(formatInviteCodeInput('ALG-ABCD-2345-EXTRA')).toBe('ALG-ABCD-2345');
    expect(formatInviteCodeInput('  alg abcd 2345 ')).toBe('ALG-ABCD-2345');
    expect(formatInviteCodeInput('')).toBe('');
    // Xoá lùi qua dấu gạch không bị kẹt
    expect(formatInviteCodeInput('ALG-ABCD-')).toBe('ALG-ABCD');
  });

  it('đủ 8 ký tự mới bấm được; cảnh báo ký tự dễ nhầm (0/1/I/L/O)', () => {
    expect(isCompleteInviteCode('ALG-ABCD-2345')).toBe(true);
    expect(isCompleteInviteCode('ALG-ABCD-234')).toBe(false);
    expect(hasAmbiguousChars('ALG-ABCD-2345')).toBe(false);
    expect(hasAmbiguousChars('ALG-AB0D-1LIO')).toBe(true);
  });

  it('lỗi đổi mã → khoá i18n theo details.reason của API', () => {
    expect(redeemErrorKey(err(400, 'validation_failed', { reason: 'invite_invalid' }))).toBe('invalid');
    expect(redeemErrorKey(err(409, 'conflict', { reason: 'invite_used' }))).toBe('used');
    expect(redeemErrorKey(err(409, 'conflict', { reason: 'already_beta' }))).toBe('alreadyBeta');
    expect(redeemErrorKey(err(403, 'forbidden', { reason: 'guest_not_allowed' }))).toBe('guest');
    expect(redeemErrorKey(err(429, 'rate_limited', { bucket: 'beta_redeem' }))).toBe('rateLimited');
    expect(redeemErrorKey(new TypeError('Failed to fetch'))).toBe('network');
    expect(redeemErrorKey(err(500, 'internal'))).toBe('generic');
  });
});
