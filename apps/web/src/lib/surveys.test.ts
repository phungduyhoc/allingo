import { describe, expect, it } from 'vitest';
import { activeNps, betaOnboardingPending, NPS_SNOOZE_MS, npsBucket, npsToShow, type PendingSurvey } from './surveys';

const NOW = Date.parse('2026-11-08T05:00:00Z');
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const d7: PendingSurvey = { kind: 'nps_d7', due_at: iso(-24), expires_at: iso(24 * 5) };
const d14: PendingSurvey = { kind: 'nps_d14', due_at: iso(-1), expires_at: iso(24 * 13) };

describe('NPS in-app (S12)', () => {
  it('chỉ NPS trong khung due ≤ now < expires; ưu tiên ngày 14', () => {
    expect(activeNps([d7], NOW)?.kind).toBe('nps_d7');
    expect(activeNps([d7, d14], NOW)?.kind).toBe('nps_d14');
    expect(activeNps([{ ...d7, due_at: iso(2) }], NOW)).toBeNull();
    expect(activeNps([{ ...d7, expires_at: iso(-1) }], NOW)).toBeNull();
    expect(activeNps([{ kind: 'beta_onboarding', due_at: iso(-1), expires_at: null }], NOW)).toBeNull();
    expect(activeNps(undefined, NOW)).toBeNull();
  });

  it('không hiện khi Exam Mode, khi "Để sau" còn hiệu lực hoặc đã gửi trong phiên', () => {
    const base = { pending: [d7], snoozedUntil: {}, now: NOW };
    expect(npsToShow({ ...base, examLocked: false })?.kind).toBe('nps_d7');
    expect(npsToShow({ ...base, examLocked: true })).toBeNull();
    expect(npsToShow({ ...base, examLocked: false, snoozedUntil: { nps_d7: NOW + NPS_SNOOZE_MS } })).toBeNull();
    expect(npsToShow({ ...base, examLocked: false, snoozedUntil: { nps_d7: NOW - 1 } })?.kind).toBe('nps_d7');
    expect(npsToShow({ ...base, examLocked: false, dismissed: new Set(['nps_d7']) })).toBeNull();
  });

  it('khảo sát onboarding beta đang chờ; nhóm NPS chuẩn', () => {
    expect(betaOnboardingPending([{ kind: 'beta_onboarding', due_at: iso(0), expires_at: null }])).toBe(true);
    expect(betaOnboardingPending([d7])).toBe(false);
    expect([0, 6, 7, 8, 9, 10].map(npsBucket)).toEqual(['detractor', 'detractor', 'passive', 'passive', 'promoter', 'promoter']);
  });
});
