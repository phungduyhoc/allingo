import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { prepareTestDatabase } from './setup.js';

/**
 * Worker (createApplicationContext) phải resolve được MediaProcessorService cho queue `media`.
 * Chỉ compile – KHÔNG gọi init() nên không bật timer/BullMQ processor (không đụng worker dev đang chạy).
 */
describe('worker module – handler media.process (integration)', () => {
  let mod: TestingModule;
  beforeAll(async () => {
    process.env.DATABASE_URL = await prepareTestDatabase();
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-secret-at-least-32-characters-long-ok';
    resetEnvCache();
    loadEnv();
    const { WorkerModule } = await import('../../src/worker/worker.module.js');
    mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  });
  afterAll(async () => {
    await mod?.close();
  });

  it('WorkerRunner + MediaProcessorService resolve; bảng handler có media.process', async () => {
    const { WorkerRunner } = await import('../../src/worker/worker.runner.js');
    const { MediaProcessorService, mediaJobHandlers, MEDIA_PROCESS_JOB } = await import('../../src/modules/speech/index.js');
    expect(mod.get(WorkerRunner)).toBeTruthy();
    const processor = mod.get(MediaProcessorService);
    expect(Object.keys(mediaJobHandlers(processor))).toEqual([MEDIA_PROCESS_JOB]);
    // asset không tồn tại → no-op (job bị xoá asset không lỗi)
    expect(await processor.handleJob({ data: { media_asset_id: '00000000-0000-4000-8000-00000000abcd' }, attemptsMade: 0, opts: { attempts: 3 } })).toMatchObject({ status: 'missing' });
  });
});
