import { describe, expect, it } from 'vitest';
import { BETA_DEFAULTS, isStaffRoles, scorePartOf, scoreScaleOf } from '@allingo/schemas';
import { base32Decode, base32Encode, hotp, totp, verifyTotp, otpauthUrl, newRecoveryCode, normalizeRecoveryCode } from '../../src/modules/iam/mfa/totp.js';
import { checkPasswordPolicy } from '../../src/modules/iam/password/password-policy.js';
import { maskEmail, maskPhone } from '../../src/modules/iam/admin-users.service.js';
import { policyCatalog } from '../../src/modules/iam/legal/legal.controller.js';
import { betaAccessDecision, generateInviteCode, hashInviteCode, normalizeInviteCode, remainingInvites, resolveBetaConfig, vnDayStart } from '../../src/modules/growth/beta/beta-rules.js';
import { pendingSurveys } from '../../src/modules/growth/support/surveys.service.js';
import { pointBiserial, recommendQuestion } from '../../src/modules/analytics/content-stats.js';
import { isoWeekOf, isoWeekRange, npsSummary, renderBetaReport, type BetaKpis } from '../../src/modules/analytics/beta-report.js';
import { deadLetterJobName } from '../../src/modules/admin/admin-ops.service.js';
import { adminMfaRequired, constantTimeEquals } from '../../src/shared/auth/auth.guard.js';
import { reconciliationEmail } from '../../src/modules/billing/reconciliation.service.js';

describe('S12 – TOTP/HOTP (RFC 4226 Phụ lục D, RFC 6238 Phụ lục B)', () => {
  const sha1 = Buffer.from('12345678901234567890');
  const sha256 = Buffer.from('12345678901234567890123456789012');
  const sha512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');

  it('HOTP 10 giá trị đầu', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => hotp(sha1, c))).toEqual(['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']);
  });

  it.each([
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ])('TOTP T=%i (8 số): SHA1/SHA256/SHA512', (t, s1, s256, s512) => {
    const ms = t * 1000;
    expect(totp(sha1, ms, { digits: 8 })).toBe(s1);
    expect(totp(sha256, ms, { digits: 8, algorithm: 'sha256' })).toBe(s256);
    expect(totp(sha512, ms, { digits: 8, algorithm: 'sha512' })).toBe(s512);
  });

  it('base32 khứ hồi + vector RFC 4648; otpauth URL', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
    const secret = Buffer.from('0123456789abcdefghij');
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(otpauthUrl({ issuer: 'Allingo', account: 'admin@allingo.dev', secretBase32: 'ABC' })).toBe('otpauth://totp/Allingo:admin%40allingo.dev?secret=ABC&issuer=Allingo&algorithm=SHA1&digits=6&period=30');
  });

  it('verify: cửa sổ ±1 bước, chống dùng lại bước đã dùng, sai định dạng', () => {
    const now = 1_794_139_200_000;
    const code = totp(sha1, now);
    const prev = totp(sha1, now - 30_000);
    expect(verifyTotp(sha1, code, now)).toMatchObject({ ok: true });
    expect(verifyTotp(sha1, prev, now)).toMatchObject({ ok: true });
    expect(verifyTotp(sha1, totp(sha1, now - 90_000), now)).toEqual({ ok: false, reason: 'invalid' });
    const r = verifyTotp(sha1, code, now) as { ok: true; step: number };
    expect(verifyTotp(sha1, code, now, { lastUsedStep: r.step })).toEqual({ ok: false, reason: 'replayed' });
    expect(verifyTotp(sha1, '12345', now)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('mã khôi phục XXXXX-XXXXX, chuẩn hoá không phân biệt hoa thường/dấu gạch', () => {
    const c = newRecoveryCode();
    expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(normalizeRecoveryCode(c.toLowerCase())).toBe(c.replace('-', ''));
  });

  it('constantTimeEquals + ADMIN_MFA_REQUIRED auto (staging/production bật, dev/test tắt)', () => {
    expect(constantTimeEquals('dev-internal-token', 'dev-internal-token')).toBe(true);
    expect(constantTimeEquals('dev-internal-token', 'dev-internal-tokeX')).toBe(false);
    expect(constantTimeEquals('a', 'ab')).toBe(false);
    expect(adminMfaRequired({ ADMIN_MFA_REQUIRED: 'auto', APP_ENV: 'production' })).toBe(true);
    expect(adminMfaRequired({ ADMIN_MFA_REQUIRED: 'auto', APP_ENV: 'staging' })).toBe(true);
    expect(adminMfaRequired({ ADMIN_MFA_REQUIRED: 'auto', APP_ENV: 'development' })).toBe(false);
    expect(adminMfaRequired({ ADMIN_MFA_REQUIRED: 'true', APP_ENV: 'test' })).toBe(true);
    expect(adminMfaRequired({ ADMIN_MFA_REQUIRED: 'false', APP_ENV: 'production' })).toBe(false);
  });
});

describe('S12 – chính sách mật khẩu', () => {
  const p = (pw: string, ctx: string[] = []) => checkPasswordPolicy(pw, { minLength: 12, context: ctx });
  it('độ dài ≥ 12 (đếm ký tự Unicode)', () => {
    expect(p('Abc!12345xy')).toBe('password_too_short');
    expect(p('Học-viên-2026')).toBeNull();
  });
  it('danh sách lộ + biến thể từ gốc + hậu tố', () => {
    for (const pw of ['Password123!', 'password1234', 'QWERTYUIOP123', 'Matkhau@2026', 'anhyeuem123456', '123456789012', 'iloveyou12345', 'Welcome2026!!']) expect(p(pw)).toBe('password_breached');
  });
  it('yếu: ký tự lặp, dãy liên tiếp, chứa email/tên', () => {
    expect(p('aaaaaaaaaaaa')).toBe('password_breached');
    expect(p('zzzzzzzzzzzz')).toBe('password_weak');
    expect(p('abababababab')).toBe('password_weak');
    expect(p('abcdefghijklm')).toBe('password_weak');
    expect(p('nguyenvana2026', ['nguyenvana@example.com'])).toBe('password_weak');
  });
  it('mật khẩu mạnh + mật khẩu demo đã cấp vẫn hợp lệ; tắt kiểm tra lộ chỉ còn độ dài', () => {
    for (const pw of ['Hoc-vien#S12-xK9q', 'Allingo@2026', 'tram-nam-trong-coi-nguoi-ta']) expect(p(pw)).toBeNull();
    expect(checkPasswordPolicy('Password123!', { minLength: 12, breachCheck: false })).toBeNull();
  });
});

describe('S12 – beta gate & mời', () => {
  it('ma trận quyết định: gate tắt → qua; vai trò nội bộ/beta_tester → qua; allowlist → qua; đã đổi mã → qua; còn lại → chặn', () => {
    const base = { gateEnabled: true, roles: ['learner'], allowlisted: false, redeemed: false };
    expect(betaAccessDecision({ ...base, gateEnabled: false })).toEqual({ allowed: true, reason: 'gate_off' });
    for (const r of ['admin', 'superadmin', 'teacher', 'editor', 'service', 'beta_tester']) expect(betaAccessDecision({ ...base, roles: ['learner', r] })).toEqual({ allowed: true, reason: 'role' });
    expect(betaAccessDecision({ ...base, roles: ['org_admin'] })).toEqual({ allowed: false, reason: 'none' });
    expect(betaAccessDecision({ ...base, allowlisted: true })).toEqual({ allowed: true, reason: 'allowlist' });
    expect(betaAccessDecision({ ...base, redeemed: true })).toEqual({ allowed: true, reason: 'invite' });
    expect(betaAccessDecision(base)).toEqual({ allowed: false, reason: 'none' });
    expect(betaAccessDecision({ ...base, roles: [] })).toEqual({ allowed: false, reason: 'none' });
  });

  it('cấu hình: mặc định 60 ngày / 2.000 credit / 50 mời/ngày; giá trị sai kiểu/ngoài khoảng bị bỏ qua', () => {
    expect(resolveBetaConfig(undefined)).toMatchObject({ trial_days: 60, credits: 2000, daily_invite_limit: 50, invite_ttl_days: 14, program: 'toeic' });
    expect(resolveBetaConfig({ daily_invite_limit: 10, credits: '5', trial_days: 9999, program: 'IELTS!' })).toMatchObject({ daily_invite_limit: 10, credits: BETA_DEFAULTS.credits, trial_days: 60, program: 'toeic' });
  });

  it('mã mời ALG-XXXX-XXXX, chuẩn hoá (hoa/thường, gạch, thiếu tiền tố) cùng hash', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^ALG-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const tail = code.slice(4);
    expect(normalizeInviteCode(code.toLowerCase())).toBe(code.replaceAll('-', ''));
    expect(hashInviteCode(` ${code.toLowerCase()} `)).toBe(hashInviteCode(code));
    expect(hashInviteCode(tail)).toBe(hashInviteCode(code));
    expect(new Set(Array.from({ length: 200 }, () => generateInviteCode())).size).toBe(200);
  });

  it('đầu ngày giờ VN + hạn mức còn lại', () => {
    expect(vnDayStart(new Date('2026-11-08T16:59:00Z')).toISOString()).toBe('2026-11-07T17:00:00.000Z');
    expect(vnDayStart(new Date('2026-11-08T17:00:00Z')).toISOString()).toBe('2026-11-08T17:00:00.000Z');
    expect(remainingInvites(50, 48)).toBe(2);
    expect(remainingInvites(50, 60)).toBe(0);
    expect(remainingInvites(50, 10, 5)).toBe(5);
  });

  it('NPS ngày 7 hiển thị [7, 14), ngày 14 hiển thị [14, 28); onboarding beta khi chưa trả lời', () => {
    const base = new Date('2026-11-01T00:00:00Z');
    const at = (d: number) => new Date(base.getTime() + d * 86_400_000);
    const kinds = (d: number, answered: string[] = [], tester = true, staff = false) => pendingSurveys({ base, now: at(d), answered: new Set(answered as never), betaTester: tester, staff }).map((x) => x.kind);
    expect(kinds(0)).toEqual(['beta_onboarding']);
    expect(kinds(6.9, ['beta_onboarding'])).toEqual([]);
    expect(kinds(7, ['beta_onboarding'])).toEqual(['nps_d7']);
    expect(kinds(13.9, ['beta_onboarding', 'nps_d7'])).toEqual([]);
    expect(kinds(14, ['beta_onboarding', 'nps_d7'])).toEqual(['nps_d14']);
    expect(kinds(28, ['beta_onboarding'])).toEqual([]);
    // B6/S146: không phải beta tester → không NPS/onboarding; nhân sự (kể cả có vai trò tester) → không khảo sát
    expect(kinds(8, [], false)).toEqual([]);
    expect(kinds(15, ['beta_onboarding'], false)).toEqual([]);
    expect(kinds(8, [], true, true)).toEqual([]);
  });

  it('STAFF_ROLES: admin/editor/teacher/support là nhân sự; learner/org_admin/beta_tester thì không', () => {
    expect(isStaffRoles(['learner', 'admin'])).toBe(true);
    expect(isStaffRoles(['editor'])).toBe(true);
    expect(isStaffRoles(['teacher', 'beta_tester'])).toBe(true);
    expect(isStaffRoles(['support'])).toBe(true);
    expect(isStaffRoles(['learner', 'beta_tester', 'org_admin'])).toBe(false);
    expect(isStaffRoles([])).toBe(false);
  });
});

describe('S12 – thống kê câu (CTT)', () => {
  it('point-biserial = Pearson (đối chiếu tính tay)', () => {
    // đúng: rest 0.9, 0.8, 0.7; sai: rest 0.3, 0.4 → r cao dương
    const obs = [
      { correct: true, rest: 0.9 },
      { correct: true, rest: 0.8 },
      { correct: true, rest: 0.7 },
      { correct: false, rest: 0.3 },
      { correct: false, rest: 0.4 },
    ];
    const r = pointBiserial(obs)!;
    // tay: M1 = 0.8, M0 = 0.35, s_n(Y) = sqrt(0.0536) = 0.23152 → r = (0.45 / 0.23152) × sqrt(0.6 × 0.4) = 0.9522
    expect(r).toBeCloseTo(0.9522, 3);
    expect(pointBiserial(obs.map((o) => ({ ...o, correct: !o.correct })))).toBeCloseTo(-0.9522, 3);
    expect(pointBiserial([{ correct: true, rest: 0.5 }, { correct: true, rest: 0.6 }])).toBeNull();
    expect(pointBiserial([{ correct: true, rest: 0.5 }])).toBeNull();
  });

  it('đề xuất retire/review/ok/insufficient_data theo ngưỡng', () => {
    const s = (o: Partial<{ n: number; p_value: number | null; discrimination: number | null; reports_open: number; reports_confirmed: number }>) => recommendQuestion({ n: 100, p_value: 0.6, discrimination: 0.35, reports_open: 0, reports_confirmed: 0, ...o }, 30);
    expect(s({})).toEqual({ recommendation: 'ok', reasons: [] });
    expect(s({ discrimination: -0.1 })).toMatchObject({ recommendation: 'retire', reasons: ['negative_discrimination'] });
    expect(s({ discrimination: 0.05 })).toMatchObject({ recommendation: 'retire', reasons: ['very_low_discrimination'] });
    expect(s({ discrimination: 0.15 })).toMatchObject({ recommendation: 'review', reasons: ['low_discrimination'] });
    expect(s({ p_value: 0.1 })).toMatchObject({ recommendation: 'review', reasons: ['too_hard'] });
    expect(s({ p_value: 0.97 })).toMatchObject({ recommendation: 'review', reasons: ['too_easy'] });
    expect(s({ reports_open: 3 })).toMatchObject({ recommendation: 'review', reasons: ['many_open_reports'] });
    expect(s({ reports_confirmed: 5, n: 3 })).toMatchObject({ recommendation: 'retire', reasons: ['many_confirmed_reports'] });
    expect(s({ n: 10, p_value: 0.05, discrimination: -0.5 })).toEqual({ recommendation: 'insufficient_data', reasons: ['insufficient_data'] });
  });
});

describe('S12 – báo cáo beta tuần', () => {
  it('tuần ISO theo giờ VN', () => {
    const w = isoWeekRange('2026-W45');
    expect(w.start.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-08T17:00:00.000Z');
    expect(isoWeekOf(new Date('2026-11-08T00:00:00Z'))).toEqual({ year: 2026, week: 45 });
    expect(isoWeekOf(new Date('2027-01-01T00:00:00Z'))).toEqual({ year: 2026, week: 53 });
    // Mặc định = tuần trước của now (CN 08/11/2026 → W44)
    expect(isoWeekRange(undefined, new Date('2026-11-08T05:00:00Z')).week).toBe('2026-W44');
    expect(() => isoWeekRange('2026-45')).toThrow();
  });

  it('NPS = %promoter − %detractor', () => {
    const r = npsSummary([...[10, 9, 9, 10, 8, 7, 6, 3].map((score) => ({ kind: 'nps_d7', score })), { kind: 'nps_d14', score: 10 }]);
    expect(r).toMatchObject({ responses: 9, promoters: 5, passives: 2, detractors: 2 });
    expect(r.score).toBeCloseTo(33.3, 1);
    expect(r.by_kind.nps_d7).toEqual({ responses: 8, score: 25 });
    expect(npsSummary([]).score).toBeNull();
  });

  it('Markdown: bảng KPI + nhãn DỮ LIỆU GIẢ LẬP + PostHog "chưa có"', () => {
    const k: BetaKpis = {
      week: '2026-W45', range: { start: 'a', end: 'b' }, simulated: true,
      cohort: { testers: 50, new_this_week: 10, invites_sent: 60, invites_redeemed: 50, waitlist: 120 },
      activation: { eligible: 50, activated: 34, rate: 0.68 },
      retention: { d1: { eligible: 50, retained: 30, rate: 0.6 }, d7: { eligible: 40, retained: 12, rate: 0.3 }, d14: { eligible: 20, retained: 5, rate: 0.25 } },
      engagement: { active_testers: 40, sessions: 120, sessions_per_active_tester: 3, sessions_per_tester: 2.4, questions_per_tester: 80, explains_per_tester: 6 },
      ai: { feedback: 100, thumbs_up: 85, thumbs_up_rate: 0.85, cost_usd: 1.2, cost_per_tester_usd: 0.024, refused: 2 },
      nps: { responses: 20, promoters: 10, passives: 6, detractors: 4, score: 30, by_kind: { nps_d7: { responses: 12, score: 25 }, nps_d14: { responses: 8, score: 37.5 } } },
      conversion: { checkout_users: 8, checkout_rate: 0.16, paid_orders: 3 },
      support: { feedback: 12, content_reports: 5, content_reports_open: 2, content_reports_overdue: 1, tickets: 4, tickets_open: 1, tickets_overdue: 0, median_first_response_hours: 3.5 },
      crash_free: { rate: null, source: 'chưa có' },
    };
    const md = renderBetaReport(k, null, new Date('2026-11-09T01:00:00Z'));
    expect(md).toContain('# Báo cáo beta kín – tuần 2026-W45');
    expect(md).toContain('DỮ LIỆU GIẢ LẬP');
    expect(md).toContain('| Activation (chẩn đoán xong ≤ 24 giờ) | 68.0 % | 34/50 | ≥ 60 % | ĐẠT |');
    expect(md).toContain('| Giữ chân D7 | 30.0 % | 12/40 | ≥ 35 % | CHƯA ĐẠT |');
    expect(md).toContain('| NPS (ngày 7 + 14, tích luỹ) | 30 | 20 trả lời | ≥ 30 | ĐẠT |');
    expect(md).toContain('chưa có (POSTHOG_PROJECT_ID');
    expect(md).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\./);
  });
});

describe('S12 – tiện ích admin/ops', () => {
  it('che email/SĐT', () => {
    expect(maskEmail('learner_free@allingo.dev')).toBe('le***@allingo.dev');
    expect(maskEmail('ab@x.vn')).toBe('****@x.vn');
    expect(maskEmail(null)).toBeNull();
    expect(maskPhone('+84912345678')).toBe('+84******678');
  });
  it('tên job dead-letter: cột job_name → tiền tố jobId → media.process', () => {
    expect(deadLetterJobName({ jobName: 'invoice.issue', jobId: 'x', queue: 'maintenance' })).toBe('invoice.issue');
    expect(deadLetterJobName({ jobName: null, jobId: 'summary.attempt__abc', queue: 'grading' })).toBe('summary.attempt');
    expect(deadLetterJobName({ jobName: null, jobId: '6f1c', queue: 'media' })).toBe('media.process');
    expect(deadLetterJobName({ jobName: null, jobId: '6f1c', queue: 'notify' })).toBeNull();
  });
  it('văn bản pháp lý: 4 loại, placeholder chờ luật sư, voice_consent ↔ voice_processing', () => {
    const c = policyCatalog({ POLICY_VERSION: '2026-11', REFUND_POLICY_VERSION: '2026-11-15', VOICE_CONSENT_VERSION: '2026-12' });
    expect(c.map((x) => x.type)).toEqual(['terms', 'privacy', 'refund_policy', 'voice_consent']);
    expect(c.every((x) => x.status === 'draft_pending_legal_review')).toBe(true);
    expect(c.find((x) => x.type === 'voice_consent')).toMatchObject({ consent_type: 'voice_processing', effective_date: '2026-12-01' });
    expect(c.find((x) => x.type === 'refund_policy')).toMatchObject({ consent_type: 'refund_policy', effective_date: '2026-11-15', requires_consent: false });
  });
  it('email đối soát: khớp/lệch, không PII', () => {
    const ok = reconciliationEmail({ for_date: '2026-11-07', runs: 1, mismatched: 0, skipped: 0, details: [{ provider: 'mock', status: 'matched', mismatches: 0, run_id: 'r1', error: null }] }, 'http://localhost:3000');
    expect(ok.subject).toBe('[Allingo billing] Đối soát 2026-11-07: khớp');
    const bad = reconciliationEmail({ for_date: '2026-11-07', runs: 2, mismatched: 1, skipped: 0, details: [{ provider: 'vnpay', status: 'mismatched', mismatches: 3, run_id: 'r2', error: null }, { provider: 'momo', status: 'error', mismatches: 0, run_id: null, error: 'timeout' }] }, 'http://x');
    expect(bad.subject).toContain('1 cổng lệch, có lỗi');
    expect(bad.text).toContain('lệch=3');
    expect(bad.html).toContain('<td>vnpay</td>');
  });
  it('thang điểm theo phần (fix web S10): mini một kỹ năng 5–495, tổng 10–990', () => {
    expect(scorePartOf({ total: 600, listening: 300, reading: 300 })).toBe('total');
    expect(scorePartOf({ total: null, listening: 300, reading: null })).toBe('listening');
    expect(scorePartOf({ listening: 300, reading: 250 })).toBe('total');
    expect(scorePartOf({ total: null, listening: null, reading: 250 })).toBe('reading');
    expect(scorePartOf(null)).toBe('total');
    expect(scoreScaleOf('toeic', 'listening')).toEqual({ min: 5, max: 495 });
    expect(scoreScaleOf('toeic', 'total')).toEqual({ min: 10, max: 990 });
  });
});
