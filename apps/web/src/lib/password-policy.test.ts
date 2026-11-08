import { describe, expect, it } from 'vitest';
import { ApiError } from '@allingo/api-client';
import { PASSWORD_MIN_LENGTH, passwordPolicyIssue } from './password-policy';

const v = (details: Record<string, unknown>) => new ApiError(400, { error: { code: 'validation_failed', message: 'Password does not meet the policy', details } });

describe('chính sách mật khẩu đăng ký (API S12)', () => {
  it('đọc issues[].code của trường password + min_length', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(passwordPolicyIssue(v({ issues: [{ path: 'password', code: 'password_too_short' }], min_length: 12 }))).toEqual({ code: 'password_too_short', minLength: 12 });
    expect(passwordPolicyIssue(v({ issues: [{ path: ['password'], code: 'password_breached' }] }))).toEqual({ code: 'password_breached', minLength: 12 });
    expect(passwordPolicyIssue(v({ issues: [{ path: 'email', code: 'invalid' }, { path: 'password', code: 'password_weak' }], min_length: 14 }))).toEqual({ code: 'password_weak', minLength: 14 });
  });
  it('lỗi khác → null', () => {
    expect(passwordPolicyIssue(v({ issues: [{ path: 'email', code: 'invalid_format' }] }))).toBeNull();
    expect(passwordPolicyIssue(v({ issues: [{ path: 'password', code: 'too_small' }] }))).toBeNull();
    expect(passwordPolicyIssue(new ApiError(409, { error: { code: 'conflict', message: 'x' } }))).toBeNull();
    expect(passwordPolicyIssue(new Error('x'))).toBeNull();
  });
});
