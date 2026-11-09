import { describe, expect, it } from 'vitest';
import { isMissingAppRoute } from '@/lib/app-routes';
import { formatAnswer } from '@/lib/format-answer';
import { resolveNotificationHref } from '@/features/notifications/notification-text';
import { defaultPracticeSection, practicePresetFrom, practiceSectionsFor } from '@/features/practice/practice-preset';
import { targetPresetsFor, targetRangeFor } from '@/features/onboarding/onboarding-store';

/** C1 – khu học đa chương trình `/[program]/…`: 404 thật cho mã sai, URL `/toeic/...` giữ nguyên, helper theo registry */
describe('C1 – route /[program]/… ở proxy', () => {
  it('mã chương trình hợp lệ → không 404 (mọi trang khu học, kể cả trang con)', () => {
    for (const p of ['toeic', 'ielts', 'jlpt', 'hsk']) {
      for (const page of ['dashboard', 'test-sets', 'practice', 'errors', 'stats', 'plan', 'today', 'diagnostic', 'vocab', 'vocab/review', 'vocab/lists/abc']) expect(isMissingAppRoute(`/${p}/${page}`), `/${p}/${page}`).toBe(false);
    }
  });
  it('mã chương trình sai → 404 thật (như S152)', () => {
    for (const p of ['/foo/dashboard', '/ielts2/test-sets', '/TOEIC/dashboard', '/xx/vocab/review']) expect(isMissingAppRoute(p), p).toBe(true);
  });
  it('route tĩnh trùng tên trang khu học không bị chặn', () => {
    for (const p of ['/account/plan', '/blog/practice', '/lessons/les-9', '/khong-ton-tai', '/vi']) expect(isMissingAppRoute(p), p).toBe(false);
  });
});

describe('C1 – thông báo trỏ về khu học của chương trình đang học', () => {
  it('đường dẫn chung → /<program>/…; /toeic/... cũ giữ nguyên; chặn URL ngoài', () => {
    expect(resolveNotificationHref('/practice')).toBe('/toeic/practice');
    expect(resolveNotificationHref('/plan?proposal=1', 'ielts')).toBe('/ielts/plan?proposal=1');
    expect(resolveNotificationHref('/vi/today', 'ielts')).toBe('/ielts/today');
    expect(resolveNotificationHref('/stats', 'ielts')).toBe('/ielts/dashboard');
    expect(resolveNotificationHref('/toeic/test-sets', 'ielts')).toBe('/toeic/test-sets');
    expect(resolveNotificationHref('//evil.example/x')).toBeNull();
    expect(resolveNotificationHref('javascript:alert(1)')).toBeNull();
  });
});

describe('C1 – luyện tập & mục tiêu theo registry', () => {
  it('phần luyện tập: TOEIC Part 1–7 (mặc định Part 5), IELTS listening/reading (mặc định reading_p1)', () => {
    expect(practiceSectionsFor('toeic')).toEqual(['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7']);
    expect(defaultPracticeSection('toeic')).toBe('part5');
    expect(practiceSectionsFor('ielts')).toContain('listening_p3');
    expect(defaultPracticeSection('ielts')).toBe('reading_p1');
    const params = new URLSearchParams('section=part5&subskill=verb_tense');
    expect(practicePresetFrom(params, 'ielts').section).toBeNull();
    expect(practicePresetFrom(params, 'toeic')).toMatchObject({ section: 'part5', subskill: 'verb_tense' });
    expect(practicePresetFrom(new URLSearchParams('section=reading_p2'), 'ielts').section).toBe('reading_p2');
  });
  it('mục tiêu: TOEIC 10–990 bước 5, IELTS band 4–9 bước 0,5', () => {
    expect(targetRangeFor('toeic')).toEqual({ min: 10, max: 990, step: 5, default: 650 });
    expect(targetRangeFor('ielts')).toEqual({ min: 4, max: 9, step: 0.5, default: 6.5 });
    for (const v of targetPresetsFor('ielts')) {
      expect(v).toBeGreaterThanOrEqual(4);
      expect(v).toBeLessThanOrEqual(9);
      expect((v * 2) % 1).toBe(0);
    }
    expect(targetPresetsFor('khac')).toEqual(targetPresetsFor('toeic'));
  });
});

describe('C2 – formatAnswer cho dạng nhiều mục', () => {
  it('nối (pairs), điền từ / ngân hàng từ (gaps), bản đồ (values), Choose TWO (selected)', () => {
    expect(formatAnswer({ type: 'matching_headings', pairs: { B: 'iii', C: 'v' } })).toBe('B: iii; C: v');
    expect(formatAnswer({ type: 'note_completion', gaps: { '1': 'library', '2': '7.30' } })).toBe('1: library; 2: 7.30');
    expect(formatAnswer({ type: 'plan_map_labelling', values: { '11': 'C' } })).toBe('11: C');
    expect(formatAnswer({ type: 'mcq_multi', selected: ['A', 'D'] })).toBe('A, D');
    expect(formatAnswer({ '1': ['library', 'the library'] })).toBe('1: library/the library');
  });
});
