import { describe, expect, it } from 'vitest';
import { classifyError, kindFromCode, timeoutThreshold, forecastLinear, roundToScale, recommendationText } from '../../src/modules/learning/index.js';
import { sanitizeAttribution } from '../../src/modules/iam/index.js';
import { MemoryAnalyticsSink, PostHogSink, compareAccuracy, createAnalyticsSink, deterministicUuid, hashUserId, lastWeekStarts, mondayOf, percentileOf, sumCells, targetBucket, type FetchLike } from '../../src/modules/analytics/index.js';
import type { Env } from '../../src/config/env.js';
import { NOTIFICATION_TEMPLATES } from '../../src/modules/growth/notify/templates.js';
import { renderNotification } from '../../src/modules/growth/notify/renderer.js';

const DAY = 86_400_000;

describe('S10 – phân loại lỗi theo luật', () => {
  const base = { section_code: 'part5', skill_code: 'reading', subskill_codes: [] as string[], topic_code: null, time_spent_ms: 10_000, answered: true, auto_submitted: false };

  it('bỏ trống khi tự nộp (hết giờ) → timeout; trả lời chậm hơn ngưỡng Part → timeout (ngưỡng theo Part)', () => {
    expect(classifyError({ ...base, answered: false, auto_submitted: true, subskill_codes: ['verb_tense'] })).toMatchObject({ kind: 'timeout', rule: 'unanswered_time_up' });
    expect(classifyError({ ...base, time_spent_ms: 41_000, subskill_codes: ['verb_tense'] })).toMatchObject({ kind: 'timeout', rule: 'slow', evidence: { threshold_ms: 40_000 } });
    expect(classifyError({ ...base, section_code: 'part7', time_spent_ms: 41_000, subskill_codes: ['inference'] }).kind).toBe('inference');
    expect(timeoutThreshold('part2')).toBe(25_000);
    expect(timeoutThreshold('section_x')).toBe(90_000);
    // bỏ trống nhưng không hết giờ → theo subskill (không phải timeout)
    expect(classifyError({ ...base, answered: false, subskill_codes: ['word_form'] }).kind).toBe('grammar');
  });

  it('theo subskill TOEIC (ưu tiên paraphrase > trap > vocabulary > grammar > inference > listening_detail)', () => {
    expect(classifyError({ ...base, subskill_codes: ['verb_tense'] })).toMatchObject({ kind: 'grammar', rule: 'subskill', evidence: { subskill: 'verb_tense' } });
    expect(classifyError({ ...base, subskill_codes: ['vocabulary_context', 'word_form'] }).kind).toBe('vocabulary');
    expect(classifyError({ ...base, section_code: 'part7', subskill_codes: ['inference', 'paraphrase_recognition'] }).kind).toBe('paraphrase');
    expect(classifyError({ ...base, section_code: 'part2', skill_code: 'listening', subskill_codes: ['similar_sound', 'wh_question'] }).kind).toBe('trap');
    expect(classifyError({ ...base, section_code: 'part3', skill_code: 'listening', subskill_codes: ['listening_detail'] }).kind).toBe('listening_detail');
    expect(classifyError({ ...base, section_code: 'part3', skill_code: 'listening', subskill_codes: ['speaker_intent'] }).kind).toBe('inference');
  });

  it('mã lạ → quy tắc tên; không có → theo topic, rồi theo Part; còn lại other', () => {
    expect(kindFromCode('collocations_b2', 'reading')).toBe('vocabulary');
    expect(kindFromCode('detail_scan', 'listening')).toBe('listening_detail');
    expect(kindFromCode('detail_scan', 'reading')).toBe('paraphrase');
    expect(classifyError({ ...base, subskill_codes: ['unknown_x'], topic_code: 'grammar_articles' })).toMatchObject({ kind: 'grammar', rule: 'topic' });
    expect(classifyError({ ...base, section_code: 'part1', skill_code: 'listening' })).toMatchObject({ kind: 'listening_detail', rule: 'section' });
    expect(classifyError({ ...base, section_code: 'part6' }).kind).toBe('grammar');
    expect(classifyError({ ...base, section_code: 'part7' }).kind).toBe('inference');
    expect(classifyError({ ...base, section_code: 'writing_task1', skill_code: 'writing' })).toMatchObject({ kind: 'other', rule: 'default' });
  });
});

describe('S10 – dự báo v0 (hồi quy tuyến tính)', () => {
  const now = Date.UTC(2026, 10, 2);
  const scale = { min: 10, max: 990 };

  it('không có điểm → insufficient_data / need_data', () => {
    expect(forecastLinear({ points: [], now, horizon: now + 30 * DAY, target: 600, examDate: null, scale })).toMatchObject({ status: 'insufficient_data', predicted: null, recommendation: 'need_data' });
  });

  it('một điểm → dự báo = điểm đó, khoảng ±8 % thang, keep_going', () => {
    const r = forecastLinear({ points: [{ at: now - DAY, score: 500 }], now, horizon: now + 30 * DAY, target: 700, examDate: null, scale });
    expect(r).toMatchObject({ status: 'ok', predicted: 500, slopePerWeek: null, recommendation: 'keep_going', onTrack: false });
    expect(r.ciHigh! - r.predicted!).toBeGreaterThanOrEqual(75);
  });

  it('xu hướng tăng đều → dự báo tại ngày thi > hiện tại, ready_date khi chạm mục tiêu, khoảng chứa dự báo', () => {
    const points = Array.from({ length: 8 }, (_, i) => ({ at: now - (56 - i * 8) * DAY, score: 450 + i * 20 + (i % 2 ? 5 : -5) }));
    const r = forecastLinear({ points, now, horizon: now + 60 * DAY, target: 700, examDate: now + 60 * DAY, scale });
    expect(r.slopePerWeek!).toBeGreaterThan(0);
    expect(r.predicted!).toBeGreaterThan(r.current!);
    expect(r.ciLow!).toBeLessThanOrEqual(r.predicted!);
    expect(r.ciHigh!).toBeGreaterThanOrEqual(r.predicted!);
    expect(r.readyAt).not.toBeNull();
    expect(r.predicted! % 5).toBe(0);
  });

  it('chống ngoại suy: 2 điểm cách 1 ngày tăng 200 → độ dốc bị co và kẹp ±2 % thang/tuần; kẹp trong thang', () => {
    const r = forecastLinear({ points: [{ at: now - 2 * DAY, score: 300 }, { at: now - DAY, score: 500 }], now, horizon: now + 365 * DAY, target: 990, examDate: null, scale });
    expect(r.slopePerWeek!).toBeLessThanOrEqual(0.02 * 980 + 0.01);
    expect(r.predicted!).toBeLessThanOrEqual(990);
    const top = forecastLinear({ points: [{ at: now - 30 * DAY, score: 950 }, { at: now - DAY, score: 985 }], now, horizon: now + 90 * DAY, target: 900, examDate: null, scale });
    expect(top.ciHigh).toBe(990);
    expect(top.recommendation).toBe('target_reached');
  });

  it('không mục tiêu → set_target; IELTS làm tròn 0,5; văn bản khuyến nghị vi/en', () => {
    expect(forecastLinear({ points: [{ at: now - DAY, score: 6 }], now, horizon: now + 30 * DAY, target: null, examDate: null, scale: { min: 0, max: 9 } }).recommendation).toBe('set_target');
    expect(roundToScale(6.3, { min: 0, max: 9 })).toBe(6.5);
    expect(roundToScale(612, scale)).toBe(610);
    expect(recommendationText('on_track', 'vi')).toContain('Đúng hướng');
    expect(recommendationText('on_track', 'ko')).toContain('On track');
  });
});

describe('S10 – thống kê thuần', () => {
  it('cộng breakdown, so sánh 2 cửa sổ (delta điểm %), percentile mid-rank', () => {
    const cur = sumCells([{ part5: { correct: 6, total: 10 } }, { part5: { correct: 3, total: 5 }, part7: { correct: 1, total: 4 } }, null]);
    expect(cur).toEqual({ part5: { correct: 9, total: 15 }, part7: { correct: 1, total: 4 } });
    const cmp = compareAccuracy(cur, { part5: { correct: 5, total: 10 } });
    expect(cmp.part5).toEqual({ current: { correct: 9, total: 15, accuracy: 60 }, previous: { correct: 5, total: 10, accuracy: 50 }, delta: 10 });
    expect(cmp.part7!.delta).toBeNull();
    expect(percentileOf(500, [300, 400, 500, 600])).toBe(62.5);
    expect(percentileOf(100, [])).toBeNull();
  });

  it('nhóm mục tiêu ẩn danh theo chương trình; thứ Hai đầu tuần; 8 tuần gần nhất', () => {
    expect(targetBucket('toeic', 650)).toEqual({ label: '600-695', lo: 600, hi: 700 });
    expect(targetBucket('ielts', 6.7)).toEqual({ label: '6.5', lo: 6.5, hi: 7 });
    expect(targetBucket('toeic', null)).toBeNull();
    expect(mondayOf('2026-11-08')).toBe('2026-11-02'); // Chủ nhật → thứ Hai trước
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(lastWeekStarts('2026-11-04', 3)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });
});

describe('S10 – attribution (không PII)', () => {
  it('referrer chỉ còn host, landing_path bỏ query; UTM chứa email/số điện thoại bị bỏ; kênh suy ra', () => {
    const a = sanitizeAttribution({ utm_source: 'google', utm_medium: 'CPC', utm_campaign: 'toeic-600', referrer: 'https://www.google.com/search?q=a', landing_path: '/toeic?x=1#y' }, { now: new Date('2026-11-02T00:00:00Z') })!;
    expect(a).toMatchObject({ referrer_host: 'www.google.com', landing_path: '/toeic', channel: 'cpc', captured_at: '2026-11-02T00:00:00.000Z' });
    expect(sanitizeAttribution({ utm_source: 'me@example.com', utm_campaign: '+84 901 234 567' })).toBeNull();
    expect(sanitizeAttribution({ referrer: 'https://www.bing.com/' })!.channel).toBe('organic');
    expect(sanitizeAttribution({ referrer: 'https://zalo.me/x' })!.channel).toBe('referrer');
    expect(sanitizeAttribution({ referrer: 'https://allingo.vn/pricing' }, { ownHosts: ['allingo.vn'] })).toBeNull();
    expect(sanitizeAttribution(undefined, { referralCode: 'ABCD2345' })!.channel).toBe('referral');
    expect(sanitizeAttribution({ referrer: 'javascript:alert(1)' })).toBeNull();
    expect(sanitizeAttribution({})).toBeNull();
  });
});

describe('S10 – sink phễu PostHog', () => {
  it('distinct_id băm ổn định (32 hex) khác user id; uuid xác định theo khoá', () => {
    const h = hashUserId('11111111-1111-4111-8111-111111111111', 'salt');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).toBe(hashUserId('11111111-1111-4111-8111-111111111111', 'salt'));
    expect(h).not.toBe(hashUserId('11111111-1111-4111-8111-111111111111', 'other'));
    const u = deterministicUuid('order_paid:abc');
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(u).toBe(deterministicUuid('order_paid:abc'));
  });

  it('PostHogSink gửi /i/v0/e/ với api_key, uuid (không gửi dedupe_key), lỗi mạng → false', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchOk: FetchLike = (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return Promise.resolve({ ok: true, status: 200 });
    };
    const sink = new PostHogSink('phc_test', 'https://eu.i.posthog.com/', fetchOk);
    expect(await sink.capture({ event: 'order_paid', distinct_id: 'abc', dedupe_key: 'order_paid:o1', properties: { revenue: 199000 }, timestamp: '2026-11-02T00:00:00.000Z' })).toBe(true);
    expect(calls[0]!.url).toBe('https://eu.i.posthog.com/i/v0/e/');
    expect(calls[0]!.body).toMatchObject({ api_key: 'phc_test', event: 'order_paid', distinct_id: 'abc', uuid: deterministicUuid('order_paid:o1'), properties: { revenue: 199000, $lib: 'allingo-api' } });
    expect(JSON.stringify(calls[0]!.body)).not.toContain('dedupe_key');
    const failing = new PostHogSink('k', 'https://x', () => Promise.reject(new Error('ECONNREFUSED')));
    expect(await failing.capture({ event: 'x', distinct_id: 'd', dedupe_key: 'k', properties: {}, timestamp: '' })).toBe(false);
  });

  it('chọn sink theo env: test → memory; có khoá → posthog; không khoá → none', () => {
    const env = (over: Partial<Env>) => ({ ANALYTICS_SINK: 'auto', APP_ENV: 'development', POSTHOG_KEY: undefined, POSTHOG_HOST: 'https://us.i.posthog.com', ...over }) as Env;
    expect(createAnalyticsSink(env({ APP_ENV: 'test' }))).toBeInstanceOf(MemoryAnalyticsSink);
    expect(createAnalyticsSink(env({ POSTHOG_KEY: 'phc_x' })).name).toBe('posthog');
    expect(createAnalyticsSink(env({})).enabled).toBe(false);
    expect(createAnalyticsSink(env({ ANALYTICS_SINK: 'posthog' })).enabled).toBe(false);
  });
});

describe('S10 – URL trong mẫu thông báo khớp route web', () => {
  const WEB_ROUTES = [/^\/pricing$/, /^\/account\/orders\/[\w-]+$/, /^\/account\/referral$/, /^\/(toeic|ielts|jlpt|hsk)\/(practice|dashboard|today|plan|stats|vocab|errors)(\?.*)?$/, /^\/badges$/, /^\/admin\/billing\/dead-letters$/];
  it('mọi mẫu (14 mã) render URL thuộc danh sách route web; theo chương trình, thiếu program → toeic', () => {
    const links = { appUrl: 'https://allingo.vn', manageUrl: 'https://allingo.vn/m', unsubscribeUrl: null };
    expect(Object.keys(NOTIFICATION_TEMPLATES)).toHaveLength(14);
    for (const def of Object.values(NOTIFICATION_TEMPLATES)) {
      const r = renderNotification(def, 'vi', { order_id: 'o-1', proposal_id: 'p-1', program: 'toeic', streak: 3, minutes: 10 }, links);
      expect(WEB_ROUTES.some((re) => re.test(r.url))).toBe(true);
      expect(['/practice', '/today', '/stats', '/plan']).not.toContain(r.url.split('?')[0]);
    }
    expect(renderNotification(NOTIFICATION_TEMPLATES['learning.weekly_summary'], 'en', {}, links).url).toBe('/toeic/stats');
    expect(renderNotification(NOTIFICATION_TEMPLATES['learning.study_reminder'], 'vi', { program: 'ielts' }, links).url).toBe('/ielts/today');
    expect(renderNotification(NOTIFICATION_TEMPLATES['learning.plan_adjust_ready'], 'vi', { proposal_id: 'abc' }, links).url).toBe('/toeic/plan?proposal=abc');
    // 3 mẫu S9 + tóm tắt tuần có đủ vi/en cho mọi kênh
    for (const code of ['learning.streak_at_risk', 'learning.badge_awarded', 'learning.plan_adjust_ready', 'learning.weekly_summary'] as const) {
      const def = NOTIFICATION_TEMPLATES[code];
      for (const loc of ['vi', 'en'] as const) expect(def.locales[loc].push.title && def.locales[loc].inapp.title && def.locales[loc].subject).toBeTruthy();
    }
  });
});
