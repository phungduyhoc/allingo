import { describe, expect, it } from 'vitest';
import { canonicalTimeZone, dailyMinutes, defaultDraft, isValidTimeZone, timeZoneOptions, toPlanInput, validateStep } from './onboarding-store';

describe('onboarding – kiểm tra bước như API', () => {
  const today = '2026-11-02';
  it('bước 2: ngày thi phải sau hôm nay và trong 2 năm; mục tiêu 10–990', () => {
    const d = defaultDraft('Asia/Ho_Chi_Minh');
    expect(validateStep({ ...d, exam_date: '2026-11-02' }, 2, today)).toEqual({ exam_date: 'past' });
    expect(validateStep({ ...d, exam_date: '2029-01-01' }, 2, today)).toEqual({ exam_date: 'tooFar' });
    expect(validateStep({ ...d, exam_date: '2026-13-40' }, 2, today)).toEqual({ exam_date: 'invalid' });
    expect(validateStep({ ...d, exam_date: '2026-12-28', target_score: 1200 }, 2, today)).toEqual({ target_score: 'range' });
    expect(validateStep({ ...d, exam_date: null, target_score: null }, 2, today)).toEqual({});
  });

  it('bước 3: phút/tuần 60–2100, ≥ 1 ngày học, giờ nhắc HH:MM, múi giờ IANA', () => {
    const d = defaultDraft('Asia/Ho_Chi_Minh');
    expect(validateStep(d, 3, today)).toEqual({});
    expect(validateStep({ ...d, weekly_minutes: 30, study_days: [], reminder_time: '25:00', timezone: 'Mars/Base' }, 3, today)).toEqual({ weekly_minutes: 'range', study_days: 'required', reminder_time: 'invalid', timezone: 'invalid' });
    expect(validateStep({ ...d, reminder_time: null }, 3, today)).toEqual({});
    expect(isValidTimeZone('Europe/London')).toBe(true);
  });

  it('múi giờ: tên cũ của ICU → tên chuẩn, danh sách không trùng', () => {
    expect(canonicalTimeZone('Asia/Saigon')).toBe('Asia/Ho_Chi_Minh');
    expect(canonicalTimeZone('Europe/Paris')).toBe('Europe/Paris');
    const opts = timeZoneOptions('Asia/Saigon');
    expect(opts[0]).toBe('Asia/Ho_Chi_Minh');
    expect(new Set(opts).size).toBe(opts.length);
  });

  it('toPlanInput: ngày học theo thứ tự tuần, mục tiêu ghi đè; dailyMinutes như API', () => {
    const d = { ...defaultDraft('Asia/Ho_Chi_Minh'), study_days: ['sun', 'mon', 'wed'] as const, exam_date: '2026-12-28', target_score: 800 };
    expect(toPlanInput({ ...d, study_days: [...d.study_days] }, 650)).toEqual({ program: 'toeic', target_score: 650, exam_date: '2026-12-28', weekly_minutes: 300, study_days: ['mon', 'wed', 'sun'], reminder_time: '19:00', timezone: 'Asia/Ho_Chi_Minh' });
    expect(toPlanInput({ ...d, study_days: [...d.study_days], target_score: null, exam_date: null })).toEqual({ program: 'toeic', weekly_minutes: 300, study_days: ['mon', 'wed', 'sun'], reminder_time: '19:00', timezone: 'Asia/Ho_Chi_Minh' });
    expect(dailyMinutes({ weekly_minutes: 300, study_days: ['mon', 'tue', 'wed'] })).toBe(100);
    expect(dailyMinutes({ weekly_minutes: 60, study_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] })).toBe(10);
    expect(dailyMinutes({ weekly_minutes: 2100, study_days: ['mon'] })).toBe(240);
  });
});
