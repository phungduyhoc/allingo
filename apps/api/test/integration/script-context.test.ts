import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { prepareTestDatabase } from './setup.js';

/**
 * Hồi quy: `ScriptModule` (dùng bởi `pnpm --filter @allingo/api seed:media`, `generate-test-set`) phải dựng được đủ provider.
 * Trước đây thiếu ClockModule/JobsModule/ExamModeModule (@Global) → Nest không resolve QuotaService/BillingJobsService
 * và script thoát mã 1 không thông báo trên máy mới. Chỉ compile – không init (không bật timer/processor).
 */
describe('script context – ScriptModule (integration)', () => {
  let mod: TestingModule;
  beforeAll(async () => {
    process.env.DATABASE_URL = await prepareTestDatabase();
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-secret-at-least-32-characters-long-ok';
    resetEnvCache();
    loadEnv();
    const { ScriptModule } = await import('../../src/cli/script-context.js');
    mod = await Test.createTestingModule({ imports: [ScriptModule] }).compile();
  });
  afterAll(async () => {
    await mod?.close();
  });

  it('resolve TtsService, StorageService, MediaAssetsService cho seed:media', async () => {
    const { TtsService, MediaAssetsService } = await import('../../src/modules/speech/index.js');
    const { StorageService } = await import('../../src/shared/storage/storage.module.js');
    expect(mod.get(TtsService)).toBeTruthy();
    expect(mod.get(MediaAssetsService)).toBeTruthy();
    expect(mod.get(StorageService)).toBeTruthy();
  });
});
