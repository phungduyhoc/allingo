import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env.js';
import type { RedisService } from '../../src/shared/cache/redis.module.js';
import type { MailerService } from '../../src/shared/notify/mailer.service.js';
import { OtpService } from '../../src/modules/iam/otp/otp.service.js';

/** Redis "mất kết nối" → OtpService dùng Map trong bộ nhớ (kiểm tra cả logic và chế độ degrade) */
const downRedis = { isHealthy: false, safe: async () => null } as unknown as RedisService;

function makeOtp(over: Partial<Env> = {}) {
  const env = {
    APP_ENV: 'test',
    AUTH_SECRET: 'unit-test-secret-at-least-32-characters!!',
    OTP_SENDER: 'memory',
    OTP_DEV_FIXED_CODE: undefined,
    OTP_TTL_SECONDS: 300,
    OTP_MAX_ATTEMPTS: 5,
    OTP_LOCK_MINUTES: 30,
    OTP_REQUEST_LIMIT: 3,
    OTP_REQUEST_WINDOW_MINUTES: 15,
    ...over,
  } as unknown as Env;
  return new OtpService(env, downRedis, {} as MailerService);
}

describe('OtpService.normalizeIdentifier', () => {
  it('chuẩn hoá số VN 0xxx → +84xxx, bỏ khoảng trắng/dấu chấm; email về chữ thường', () => {
    expect(OtpService.normalizeIdentifier({ phone: '0901 234.567' })).toEqual({ kind: 'phone', id: '+84901234567' });
    expect(OtpService.normalizeIdentifier({ phone: '84901234567' })).toEqual({ kind: 'phone', id: '+84901234567' });
    expect(OtpService.normalizeIdentifier({ phone: '+84901234567' })).toEqual({ kind: 'phone', id: '+84901234567' });
    expect(OtpService.normalizeIdentifier({ email: '  Lan@Example.COM ' })).toEqual({ kind: 'email', id: 'lan@example.com' });
  });
});

describe('OtpService (degrade: không Redis)', () => {
  it('sinh mã 6 số, gửi qua sender, xác minh đúng một lần', async () => {
    const otp = makeOtp();
    const r = await otp.request({ email: 'a@x.vn', channel: 'email' });
    expect(r).toEqual({ channel: 'email', retryAfter: 60, expiresIn: 300 });
    const code = otp.memorySender!.last('a@x.vn')!.code;
    expect(code).toMatch(/^\d{6}$/);
    await expect(otp.verify({ email: 'A@X.vn', otp: code })).resolves.toEqual({ kind: 'email', id: 'a@x.vn' });
    await expect(otp.verify({ email: 'a@x.vn', otp: code })).rejects.toMatchObject({ code: 'unauthorized', details: { reason: 'otp_expired' } });
  });

  it('sai 4 lần báo số lần còn lại, lần 5 khoá 30 phút; khi khoá thì request cũng 429', async () => {
    const otp = makeOtp();
    await otp.request({ phone: '0912345678', channel: 'sms' });
    for (let i = 1; i <= 4; i++) {
      await expect(otp.verify({ phone: '+84912345678', otp: '999999' })).rejects.toMatchObject({ details: { reason: 'otp_invalid', attempts_left: 5 - i } });
    }
    await expect(otp.verify({ phone: '+84912345678', otp: '999999' })).rejects.toMatchObject({ code: 'rate_limited', details: { retry_after_sec: 1800 } });
    await expect(otp.request({ phone: '0912345678', channel: 'sms' })).rejects.toMatchObject({ code: 'rate_limited' });
    // Mã đúng cũng không dùng được khi đang khoá
    const code = otp.memorySender!.last('+84912345678')!.code;
    await expect(otp.verify({ phone: '+84912345678', otp: code })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('giới hạn 3 yêu cầu / cửa sổ 15 phút', async () => {
    const otp = makeOtp();
    for (let i = 0; i < 3; i++) await otp.request({ email: 'b@x.vn', channel: 'email' });
    await expect(otp.request({ email: 'b@x.vn', channel: 'email' })).rejects.toMatchObject({ code: 'rate_limited', details: { retry_after_sec: 900 } });
  });

  it('mã mới thay mã cũ; mã hết hạn bị từ chối', async () => {
    const otp = makeOtp({ OTP_TTL_SECONDS: 1 });
    await otp.request({ email: 'c@x.vn', channel: 'email' });
    const first = otp.memorySender!.last('c@x.vn')!.code;
    await otp.request({ email: 'c@x.vn', channel: 'email' });
    const second = otp.memorySender!.last('c@x.vn')!.code;
    if (first !== second) await expect(otp.verify({ email: 'c@x.vn', otp: first })).rejects.toMatchObject({ code: 'unauthorized' });
    await new Promise((r) => setTimeout(r, 1100));
    await expect(otp.verify({ email: 'c@x.vn', otp: second })).rejects.toMatchObject({ details: { reason: 'otp_expired' } });
  });

  it('OTP_DEV_FIXED_CODE dùng ở dev/test, bị bỏ qua ở production', async () => {
    const dev = makeOtp({ OTP_DEV_FIXED_CODE: '123456' });
    await dev.request({ email: 'd@x.vn', channel: 'email' });
    expect(dev.memorySender!.last('d@x.vn')!.code).toBe('123456');
    const prod = makeOtp({ APP_ENV: 'production', OTP_SENDER: 'memory', OTP_DEV_FIXED_CODE: '123456' });
    const codes = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await prod.request({ email: `p${i}@x.vn`, channel: 'email' });
      codes.add(prod.memorySender!.last(`p${i}@x.vn`)!.code);
    }
    expect(codes.has('123456') && codes.size === 1).toBe(false);
  });
});
