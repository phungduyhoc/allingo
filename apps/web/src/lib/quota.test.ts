import { describe, expect, it } from 'vitest';
import { ApiError } from '@allingo/api-client';
import { needsUpgrade, parseInsufficientCredits, parseQuotaExceeded, quotaOf, resetParts } from './quota';

const ent = {
  quotas: [
    { feature: 'ai_explain', period: 'day', limit: 10, used: 3, remaining: 7, reset_at: '2026-11-02T17:00:00.000Z' },
    { feature: 'full_test', period: 'month', limit: 2, used: 5, reset_at: '2026-11-30T17:00:00.000Z' },
    { feature: 'ai_tutor', period: 'day', limit: null, used: 4, reset_at: '2026-11-02T17:00:00.000Z' },
  ],
};

describe('quotaOf', () => {
  it('ưu tiên remaining của API; thiếu thì suy ra limit − used (không âm); limit null = không giới hạn', () => {
    expect(quotaOf(ent, 'ai_explain')).toEqual({ feature: 'ai_explain', period: 'day', limit: 10, used: 3, remaining: 7, resetAt: '2026-11-02T17:00:00.000Z' });
    expect(quotaOf(ent, 'full_test')).toMatchObject({ period: 'month', remaining: 0 });
    expect(quotaOf(ent, 'ai_tutor')).toMatchObject({ limit: null, remaining: null });
    expect(quotaOf(ent, 'mini_test')).toBeNull();
    expect(quotaOf(undefined, 'ai_explain')).toBeNull();
  });
});

describe('parseQuotaExceeded – 429 details.quota (v1.1) và dạng cũ', () => {
  it('đọc details.quota, ưu tiên resets_at', () => {
    const err = new ApiError(429, {
      error: {
        code: 'quota_exceeded',
        message: 'Daily quota reached',
        details: { quota: { feature: 'ai_explain', period: 'day', limit: 10, used: 10, remaining: 0, resets_at: '2026-11-02T17:00:00.000Z', reset_at: '2026-11-02T17:00:00.000Z' }, feature: 'ai_explain', reset_at: '2026-11-02T17:00:00.000Z', upgrade: true },
      },
    });
    expect(parseQuotaExceeded(err)).toEqual({ feature: 'ai_explain', period: 'day', limit: 10, used: 10, remaining: 0, resetAt: '2026-11-02T17:00:00.000Z' });
  });

  it('dạng phẳng cũ { feature, limit } → used = limit, remaining 0', () => {
    const err = new ApiError(429, { error: { code: 'quota_exceeded', message: 'x', details: { feature: 'mini_test', limit: 3 } } });
    expect(parseQuotaExceeded(err)).toEqual({ feature: 'mini_test', period: 'day', limit: 3, used: 3, remaining: 0, resetAt: null });
  });

  it('không phải quota_exceeded → null', () => {
    expect(parseQuotaExceeded(new ApiError(429, { error: { code: 'rate_limited', message: 'x' } }))).toBeNull();
    expect(parseQuotaExceeded(new Error('x'))).toBeNull();
  });

  it('402 insufficient_credits và 403 upgrade', () => {
    expect(parseInsufficientCredits(new ApiError(402, { error: { code: 'insufficient_credits', message: 'x', details: { required: 10, balance: 2 } } }))).toEqual({ required: 10, balance: 2 });
    expect(needsUpgrade(new ApiError(403, { error: { code: 'forbidden', message: 'x', details: { upgrade: true, feature: 'ai_diagnose' } } }))).toBe(true);
    expect(needsUpgrade(new ApiError(403, { error: { code: 'exam_mode_locked', message: 'x', details: { upgrade: true } } }))).toBe(false);
    expect(needsUpgrade(new ApiError(403, { error: { code: 'forbidden', message: 'x' } }))).toBe(false);
  });
});

describe('resetParts – thời điểm reset theo giờ Việt Nam', () => {
  const reset = '2026-11-02T17:00:00.000Z'; // 00:00 ngày 03/11 giờ VN

  it('reset ngày: 00:00 "ngày mai" khi còn trong ngày 02/11 giờ VN', () => {
    expect(resetParts(reset, 'vi', new Date('2026-11-02T03:00:00Z'))).toEqual({ time: '00:00', date: '3 tháng 11', day: 'tomorrow' });
    expect(resetParts(reset, 'en', new Date('2026-11-02T16:59:00Z'))).toEqual({ time: '00:00', date: 'November 3', day: 'tomorrow' });
  });

  it('so sánh theo ngày VN, không theo UTC: 17:30 UTC ngày 02/11 đã là 03/11 ở VN → "hôm nay"', () => {
    expect(resetParts('2026-11-03T17:00:00.000Z', 'vi', new Date('2026-11-02T17:30:00Z'))?.day).toBe('tomorrow');
    expect(resetParts(reset, 'vi', new Date('2026-11-02T17:00:00Z'))?.day).toBe('today');
  });

  it('reset tháng: 00:00 ngày 1 tháng sau', () => {
    expect(resetParts('2026-11-30T17:00:00.000Z', 'vi', new Date('2026-11-10T05:00:00Z'))).toEqual({ time: '00:00', date: '1 tháng 12', day: 'other' });
  });

  it('ISO trống/sai → null', () => {
    expect(resetParts(null, 'vi')).toBeNull();
    expect(resetParts('not-a-date', 'vi')).toBeNull();
  });
});
