import { describe, expect, it } from 'vitest';
import { XP_RULES, XP_TABLE, attemptXp, levelForXp, planAdjustOutputSchema } from '@allingo/schemas';
import { applyStudyDay, effectiveStreak, evaluateBadgeRule, evidenceText, launchOf, toInventory, type BadgeFacts, type StreakState } from '../../src/modules/learning/index.js';
import { buildMock, mockAvailableMinutes } from '../../src/modules/ai-gateway/providers/mock.provider.js';
import { renderNotification, templateFor } from '../../src/modules/growth/index.js';

const s = (over: Partial<StreakState> = {}): StreakState => ({ currentStreak: 5, longestStreak: 9, lastActiveDate: '2026-11-10', freezeAvailableAt: null, freezesUsed: 0, ...over });

describe('streak theo lịch người học (S9)', () => {
  it('ngày đầu → 1; cùng ngày không đổi; hôm sau +1; lỡ 1 ngày (Free) → 1', () => {
    expect(applyStudyDay(null, '2026-11-10', false).next).toMatchObject({ currentStreak: 1, longestStreak: 1, lastActiveDate: '2026-11-10' });
    expect(applyStudyDay(s(), '2026-11-10', false).incremented).toBe(false);
    expect(applyStudyDay(s(), '2026-11-11', false).next.currentStreak).toBe(6);
    const r = applyStudyDay(s(), '2026-11-12', false);
    expect(r).toMatchObject({ reset: true, freezeUsed: false });
    expect(r.next).toMatchObject({ currentStreak: 1, longestStreak: 9 });
  });

  it('Pro: lỡ đúng 1 ngày → dùng đóng băng, hồi sau 7 ngày; lỡ 2+ ngày hoặc đóng băng chưa hồi → về 1', () => {
    const r = applyStudyDay(s(), '2026-11-12', true);
    expect(r).toMatchObject({ freezeUsed: true, reset: false });
    expect(r.next).toMatchObject({ currentStreak: 6, freezesUsed: 1, freezeAvailableAt: '2026-11-19' });
    expect(applyStudyDay(r.next, '2026-11-14', true).next.currentStreak).toBe(1);
    expect(applyStudyDay(s(), '2026-11-13', true).reset).toBe(true);
    expect(applyStudyDay(s({ freezeAvailableAt: '2026-11-20' }), '2026-11-12', true).reset).toBe(true);
    // đổi múi giờ lùi ngày → không đổi
    expect(applyStudyDay(s(), '2026-11-09', true).incremented).toBe(false);
  });

  it('chuỗi hiển thị: học hôm nay; hôm qua → at_risk; lỡ 1 ngày còn đóng băng → giữ + at_risk; còn lại → 0', () => {
    expect(effectiveStreak(s(), '2026-11-10', false)).toMatchObject({ current: 5, at_risk: false, studied_today: true });
    expect(effectiveStreak(s(), '2026-11-11', false)).toMatchObject({ current: 5, at_risk: true });
    expect(effectiveStreak(s(), '2026-11-12', true)).toMatchObject({ current: 5, at_risk: true, freeze_available: true });
    expect(effectiveStreak(s(), '2026-11-12', false)).toMatchObject({ current: 0, at_risk: false });
    expect(effectiveStreak(s(), '2026-11-13', true).current).toBe(0);
    expect(effectiveStreak(null, '2026-11-13', true)).toMatchObject({ current: 0, longest: 0 });
  });
});

describe('rule engine huy hiệu', () => {
  const f: BadgeFacts = { attempts_graded: 1, full_tests_graded: 0, answered_total: 999, longest_streak: 6, current_streak: 6, score_delta: 45 };
  it('7 ngày, 1.000 câu, full test đầu tiên, tăng 50 điểm; rule lạ không trao', () => {
    expect(evaluateBadgeRule({ event: 'attempt.graded', count: 1 }, f)).toMatchObject({ earned: true });
    expect(evaluateBadgeRule({ streak: 7 }, f)).toEqual({ earned: false, progress: { current: 6, target: 7 } });
    expect(evaluateBadgeRule({ streak: 7 }, { ...f, current_streak: 7 }).earned).toBe(true);
    expect(evaluateBadgeRule({ answered: 1000 }, f).earned).toBe(false);
    expect(evaluateBadgeRule({ answered: 1000 }, { ...f, answered_total: 1000 }).earned).toBe(true);
    expect(evaluateBadgeRule({ event: 'attempt.graded', kind: 'full', count: 1 }, f).earned).toBe(false);
    expect(evaluateBadgeRule({ event: 'attempt.graded', kind: 'full', count: 1 }, { ...f, full_tests_graded: 1 }).earned).toBe(true);
    expect(evaluateBadgeRule({ score_delta: 50 }, f)).toEqual({ earned: false, progress: { current: 45, target: 50 } });
    expect(evaluateBadgeRule({ score_delta: 50 }, { ...f, score_delta: 55 }).earned).toBe(true);
    expect(evaluateBadgeRule({ unknown: 1 } as never, f)).toEqual({ earned: false, progress: null });
  });
});

describe('bảng XP (packages/config/xp.ts)', () => {
  it('XP_RULES tương thích; bài thường / đề full; cấp độ', () => {
    expect(XP_RULES).toBe(XP_TABLE);
    expect(attemptXp({ mode: 'practice', questionCount: 10, correct: 7 })).toBe(XP_TABLE.attempt_submitted + 7 * XP_TABLE.question_correct);
    expect(attemptXp({ mode: 'exam', questionCount: 200, correct: 150 })).toBe(XP_TABLE.attempt_full_test_submitted + 300);
    expect(attemptXp({ mode: 'exam', questionCount: 60, correct: 0 })).toBe(XP_TABLE.attempt_submitted);
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(100)).toMatchObject({ level: 2, next_at: 300 });
    expect(levelForXp(299).level).toBe(2);
  });
});

describe('mock plan_adjust + ánh xạ lộ trình', () => {
  it('"tuần này bận, chỉ 2 giờ" → reduce_load_week 120 (Zod hợp lệ); không có số → none', () => {
    expect(mockAvailableMinutes('Khó khăn: Tuần này bận, chỉ 2 giờ')).toBe(120);
    expect(mockAvailableMinutes('Tuần tới có thể học: 90 phút.\nĐã học thực tế tuần này: 30 phút.')).toBe(90);
    expect(mockAvailableMinutes('only 1.5 hours next week')).toBe(90);
    expect(mockAvailableMinutes('mệt quá')).toBeNull();
    const user = ['<data>', 'today: 2026-11-08 | exam_date: 2026-12-28 | daily_minutes: 43 | rest_days: []', 'current_week_tasks: []     # [...]', `next_week_tasks: ${JSON.stringify([{ id: 'a', date: '2026-11-09', task_type: 'part_drill', est_minutes: 200, status: 'pending' }, { id: 'b', date: '2026-11-10', task_type: 'vocab_review', est_minutes: 100, status: 'pending' }])}`, '</data>', '<user_input>', 'Tuần này bận, chỉ 2 giờ', '</user_input>'].join('\n');
    const out = planAdjustOutputSchema.parse(buildMock('plan_adjust', user));
    expect(out.operations[0]).toMatchObject({ op: 'reduce_load_week', minutes: 120, from_date: '2026-11-09' });
    const none = planAdjustOutputSchema.parse(buildMock('plan_adjust', user.replace('Tuần này bận, chỉ 2 giờ', 'ổn')));
    expect(none.operations[0]!.op).toBe('none');
  });

  it('launch theo loại task; evidence i18n; inventory từ catalog', () => {
    expect(launchOf({ taskType: 'full_test', refType: 'test_set', refId: 't' })).toMatchObject({ kind: 'attempt', mode: 'exam', test_set_id: 't' });
    expect(launchOf({ taskType: 'timed_drill', refType: 'section', refId: 's' })).toMatchObject({ kind: 'attempt', mode: 'timed_drill', section_id: 's' });
    expect(launchOf({ taskType: 'part_drill', refType: 'section', refId: 's' })).toMatchObject({ mode: 'practice' });
    expect(launchOf({ taskType: 'checkin', refType: null, refId: null })).toMatchObject({ kind: 'checkin' });
    expect(launchOf({ taskType: 'vocab_review', refType: 'vocab_list', refId: 'v' })).toMatchObject({ kind: 'vocab_list', vocab_list_id: 'v' });
    expect(evidenceText('weak_section', { section: 'part5', mastery_pct: 30 }, 'vi')).toBe('Part 5 còn yếu (thành thạo ~30%) nên được luyện nhiều hơn.');
    expect(evidenceText('cadence_full_test', { every_weeks: 2 }, 'en')).toBe('Mock test every 2 weeks to measure progress.');
    expect(evidenceText(null, {}, 'vi')).toBeNull();
    const inv = toInventory({ sections: [{ id: 's5', code: 'part5', skill: 'reading', skill_id: 'k', name: { vi: 'Part 5', en: 'Part 5' }, sort_order: 5, published_questions: 40 }], testSets: [{ id: 't', code: 'x', kind: 'full', title: { vi: 'Đề', en: 'Test' }, duration_sec: 4500, is_free: true, question_count: 100, sections: ['part5'] }], lessons: [{ id: 'l', section_code: 'part5', kind: 'grammar', title: { vi: 'Bài', en: 'Lesson' }, est_minutes: null }], vocabLists: [] });
    expect(inv.sections[0]).toMatchObject({ drill_minutes: 7, question_count: 40 });
    expect(inv.testSets[0]!.minutes).toBe(75);
    expect(inv.lessons[0]!.minutes).toBe(15);
  });
});

describe('mẫu thông báo S9 (vi/en)', () => {
  it('chuỗi sắp mất, huy hiệu, đề xuất lộ trình – có push/in-app, không thiếu biến', () => {
    const links = { appUrl: 'https://app.allingo.example', manageUrl: 'https://x', unsubscribeUrl: 'https://y' };
    const risk = renderNotification(templateFor('learning.streak_at_risk')!, 'vi', { streak: 6 }, links);
    expect(risk.push.title).toBe('Chuỗi 6 ngày sắp mất!');
    const badge = renderNotification(templateFor('learning.badge_awarded')!, 'en', { badge_name: { vi: '7 ngày liên tiếp', en: '7-day streak' } }, links);
    expect(badge.inapp.title).toBe('New badge: 7-day streak');
    expect(badge.url).toContain('/badges');
    const ready = renderNotification(templateFor('learning.plan_adjust_ready')!, 'vi', { proposal_id: 'p1' }, links);
    expect(ready.url).toContain('proposal=p1');
  });
});
