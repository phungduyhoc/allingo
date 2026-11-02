import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { schema } from '@allingo/db';
import { FEATURE_CODES } from '@allingo/schemas';
import { DbService } from '../../src/shared/db/db.module.js';
import { RedisService } from '../../src/shared/cache/redis.module.js';
import { EntitlementService, FeatureGateService } from '../../src/modules/billing/index.js';
import { bootTestApp, client } from './setup.js';

/**
 * Sửa lỗi (S9, báo từ web): `turns.limit` của /ai/threads* phải là hạn mức theo phạm vi thread từ billing.quotas
 * (`ai_tutor_thread_turns` – khách/Free 20, Pro 200), không bao giờ null do ngữ cảnh quyền thiếu planKind / gói không có dòng quota.
 */
describe('gia sư AI – turns.limit theo gói (khách / Free / Pro)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;

  beforeAll(async () => {
    app = await bootTestApp();
    dbs = app.get(DbService);
  });
  afterAll(async () => {
    await app?.close();
  });

  const turnsOf = async (api: ReturnType<typeof client>) => {
    const created = await api.call('POST', '/ai/threads', { program: 'toeic', context: { kind: 'free' } });
    expect(created.status).toBe(201);
    const list = await api.call('GET', '/ai/threads');
    const detail = await api.call('GET', `/ai/threads/${created.body.id}`);
    return { created: created.body.turns, listed: list.body.data.find((t: { id: string }) => t.id === created.body.id).turns, detail: detail.body.turns, id: created.body.id as string };
  };

  it('khách: limit 20 ở POST, GET list, GET detail và sau khi gửi tin', async () => {
    const api = client(app);
    expect((await api.call('POST', '/auth/guest', {})).status).toBe(201);
    const t = await turnsOf(api);
    for (const x of [t.created, t.listed, t.detail]) expect(x).toMatchObject({ used: 0, limit: 20, remaining: 20 });
    const send = await api.call('POST', `/ai/threads/${t.id}/messages`, { text: 'Giải thích thì hiện tại hoàn thành' });
    expect(send.status).toBe(200);
    expect(send.raw).toContain('"limit":20');
  });

  it('Free đăng ký: limit 20; Pro: limit 200', async () => {
    const free = client(app);
    expect((await free.call('POST', '/auth/register', { email: `tt-${crypto.randomUUID()}@example.com`, password: 'Password123!', display_name: 'Free', accept_terms: true })).status).toBe(201);
    const f = await turnsOf(free);
    for (const x of [f.created, f.listed, f.detail]) expect(x).toMatchObject({ limit: 20 });

    const pro = client(app);
    const reg = await pro.call('POST', '/auth/register', { email: `tt-${crypto.randomUUID()}@example.com`, password: 'Password123!', display_name: 'Pro', accept_terms: true });
    const userId = reg.body.user.id as string;
    await dbs.db.insert(schema.billingEntitlements).values(Object.values(FEATURE_CODES).map((feature) => ({ userId, programCode: 'toeic', featureCode: feature, source: 'admin', validFrom: new Date(Date.now() - 60_000), validTo: new Date(Date.now() + 86_400_000) })));
    await app.get(EntitlementService).invalidate(userId);
    const p = await turnsOf(pro);
    for (const x of [p.created, p.listed, p.detail]) expect(x).toMatchObject({ limit: 200 });
  });

  it('ngữ cảnh quyền trong cache thiếu planKind (định dạng cũ) / gói không có dòng quota → vẫn 20 (Free) / 200 (trả phí), không null', async () => {
    const api = client(app);
    const reg = await api.call('POST', '/auth/register', { email: `tt-${crypto.randomUUID()}@example.com`, password: 'Password123!', display_name: 'Cache', accept_terms: true });
    const userId = reg.body.user.id as string;
    await app.get(RedisService).safe((r) => r.set(`ent:${userId}:toeic`, JSON.stringify({ isPro: false, features: ['ai_tutor'] }), 'EX', 60));
    const t = await turnsOf(api);
    expect(t.created).toMatchObject({ limit: 20 });
    const gate = app.get(FeatureGateService);
    expect(await gate.scopedLimit('b2b_seat', 'ai_tutor')).toBe(200);
    expect(await gate.scopedLimit('credit_pack', 'ai_tutor')).toBe(20);
    expect(await gate.scopedLimit(undefined, 'ai_tutor')).toBe(20);
    expect(await gate.scopedLimit('free', 'ai_explain')).toBeNull();
  });
});
