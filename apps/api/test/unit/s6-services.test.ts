import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { normalizeLookupTerm, sanitizeNoteMarkdown } from '@allingo/schemas';
import { EXAM_LOCKED, ExamModeGuard, ExamModeService } from '../../src/shared/exam/exam-mode.js';
import type { RedisService } from '../../src/shared/cache/redis.module.js';
import { translationCacheKey } from '../../src/modules/catalog/dictionary.service.js';
import { MemoryPushSender, WebPushSender, generateVapidKeys } from '../../src/modules/growth/push/push-sender.js';
import { createPushSender } from '../../src/modules/growth/growth.module.js';
import { loadEnv, resetEnvCache, envSchema } from '../../src/config/env.js';

const fakeRedis = (flag: string | null, healthy = true) => ({ isHealthy: healthy, safe: async <T>(fn: (r: { get: () => Promise<string | null> }) => Promise<T>) => (healthy ? fn({ get: async () => flag }) : null) }) as unknown as RedisService;

function ctxFor(userId: string | null, locked: boolean): ExecutionContext {
  const handler = () => undefined;
  if (locked) Reflect.defineMetadata(EXAM_LOCKED, true, handler);
  return { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => ({ user: userId ? { id: userId } : undefined }) }) } as unknown as ExecutionContext;
}

describe('Exam Mode lock (shared)', () => {
  it('probe đăng ký → quyết định theo DB; endpoint không gắn @ExamLocked không bị chặn', async () => {
    const exam = new ExamModeService(fakeRedis(null));
    const active = new Map<string, string>([['u-exam', 'att-1']]);
    exam.registerProbe(async (u) => active.get(u) ?? null);
    const guard = new ExamModeGuard(new Reflector(), exam);
    await expect(guard.canActivate(ctxFor('u-exam', true))).rejects.toMatchObject({ code: 'exam_mode_locked', details: { attempt_id: 'att-1' } });
    await expect(guard.canActivate(ctxFor('u-free', true))).resolves.toBe(true);
    await expect(guard.canActivate(ctxFor('u-exam', false))).resolves.toBe(true);
    await expect(guard.canActivate(ctxFor(null, true))).resolves.toBe(true);
  });

  it('probe lỗi → cờ Redis; Redis cũng mất → fail-closed (403)', async () => {
    const withFlag = new ExamModeService(fakeRedis('att-9'));
    withFlag.registerProbe(async () => {
      throw new Error('db down');
    });
    expect(await withFlag.activeExamAttempt('u')).toBe('att-9');
    const noFlag = new ExamModeService(fakeRedis(null));
    noFlag.registerProbe(async () => {
      throw new Error('db down');
    });
    expect(await noFlag.activeExamAttempt('u')).toBeNull();
    const down = new ExamModeService(fakeRedis(null, false));
    down.registerProbe(async () => {
      throw new Error('db down');
    });
    await expect(down.assertNotInExam('u')).rejects.toMatchObject({ code: 'exam_mode_locked' });
  });

  it('chưa có probe → cờ Redis (tương thích S5)', async () => {
    expect(await new ExamModeService(fakeRedis('att-2')).activeExamAttempt('u')).toBe('att-2');
    expect(await new ExamModeService(fakeRedis(null)).activeExamAttempt('u')).toBeNull();
  });
});

describe('dictionary helpers', () => {
  it('normalizeLookupTerm: chữ thường, nháy cong, dấu câu bao quanh, khoảng trắng', () => {
    expect(normalizeLookupTerm('  “Invoices,” ')).toBe('invoices');
    expect(normalizeLookupTerm('Customer’s   SERVICE.')).toBe("customer's service");
    expect(normalizeLookupTerm('(follow-up)')).toBe('follow-up');
    expect(normalizeLookupTerm('...')).toBe('');
  });

  it('khoá cache dịch chuẩn hoá term + context, phụ thuộc prompt version', () => {
    const a = translationCacheKey('The shipment was delayed.', 'Context  here', 'pv1');
    expect(translationCacheKey('  the SHIPMENT was delayed ', 'context here', 'pv1')).toBe(a);
    expect(translationCacheKey('The shipment was delayed.', 'Context here', 'pv2')).not.toBe(a);
    expect(translationCacheKey('The shipment was delayed.', 'Other', 'pv1')).not.toBe(a);
  });
});

describe('notes markdown', () => {
  it('bỏ thẻ HTML/comment, liên kết javascript:, ký tự điều khiển; giữ markdown', () => {
    const raw = '**Mẹo**: <script>alert(1)</script>nhớ <b>by</b> + deadline\n\n\n\n[x](javascript:alert(1)) <!-- c --> a < b\u0007';
    const out = sanitizeNoteMarkdown(raw);
    expect(out).toBe('**Mẹo**: alert(1)nhớ by + deadline\n\n[x]()  a < b');
    expect(out).not.toMatch(/<script|javascript:|<b>/i);
  });
});

describe('Web Push sender', () => {
  const subscription = () => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  };

  it('web-push dựng request: aes128gcm + VAPID (không gửi mạng)', () => {
    const vapid = { subject: 'mailto:dev@allingo.vn', ...generateVapidKeys() };
    const d = WebPushSender.requestDetails(subscription(), JSON.stringify({ v: 1, template_code: 'study_reminder' }), vapid, 120);
    expect(d.method).toBe('POST');
    expect(d.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc123');
    expect(d.headers['Content-Encoding']).toBe('aes128gcm');
    expect(String(d.headers.Authorization)).toMatch(/^vapid t=.+, k=.+/);
    expect(d.headers.TTL).toBe(120);
    expect(Buffer.isBuffer(d.body)).toBe(true);
  });

  it('sender giả: 201 / 410 gone / 500', async () => {
    const s = new MemoryPushSender();
    expect(await s.send({ ...subscription() }, 'x', { ttlSeconds: 60 })).toMatchObject({ ok: true, statusCode: 201 });
    expect(await s.send({ ...subscription(), endpoint: 'https://push.example/gone/1' }, 'x', { ttlSeconds: 60 })).toMatchObject({ ok: false, gone: true, statusCode: 410 });
    expect(await s.send({ ...subscription(), endpoint: 'https://push.example/fail/1' }, 'x', { ttlSeconds: 60 })).toMatchObject({ ok: false, gone: false });
    expect(s.sent).toHaveLength(1);
  });

  it('createPushSender: memory | webpush khi có khoá | null khi thiếu khoá', () => {
    resetEnvCache();
    const base = envSchema.parse({ DATABASE_URL: 'postgres://x', AUTH_SECRET: 'x'.repeat(32) });
    expect(createPushSender({ ...base, PUSH_SENDER: 'memory' })?.kind).toBe('memory');
    const k = generateVapidKeys();
    expect(createPushSender({ ...base, VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey })?.kind).toBe('webpush');
    expect(createPushSender(base)).toBeNull();
    expect(() => createPushSender({ ...base, APP_ENV: 'production', PUSH_SENDER: 'webpush' })).toThrow(/VAPID/);
    void loadEnv;
  });
});
