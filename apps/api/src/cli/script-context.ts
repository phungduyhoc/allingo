import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '../config/config.module.js';
import { ClockModule } from '../shared/clock/clock.module.js';
import { DbModule } from '../shared/db/db.module.js';
import { RedisModule } from '../shared/cache/redis.module.js';
import { QueueModule } from '../shared/queue/queue.module.js';
import { JobsModule } from '../shared/queue/jobs.service.js';
import { ExamModeModule } from '../shared/exam/exam-mode.js';
import { StorageModule } from '../shared/storage/storage.module.js';
import { EventsModule } from '../shared/events/outbox.service.js';
import { NotifyModule } from '../shared/notify/mailer.service.js';
import { SharedAuthModule } from '../shared/auth/auth.module.js';
import { RealtimeModule } from '../shared/realtime/realtime.gateway.js';
import { CatalogModule } from '../modules/catalog/index.js';
import { SpeechModule } from '../modules/speech/index.js';

/**
 * Context Nest tối thiểu cho script/CLI (seed nội dung, sinh đề mini…): không mở HTTP, không chạy WorkerRunner.
 * Phải import đủ các module @Global mà AppModule/WorkerModule nạp (Clock, Jobs, ExamMode…) – thiếu → Nest không dựng được provider.
 * `abortOnError: false` + logger error: lỗi khởi tạo được in ra và ném lên script (trước đây thoát mã 1 không thông báo).
 * Có sẵn CatalogModule (MiniTestService, ContentPublishService…) và SpeechModule (TtsService, MediaAssetsService).
 * Ví dụ seed Listening: `await withScriptContext(async (app) => app.get(TtsService).createAsset(script, undefined, 'en-US'))`.
 */
@Module({ imports: [ConfigModule, ClockModule, DbModule, RedisModule, QueueModule, JobsModule, StorageModule, EventsModule, NotifyModule, SharedAuthModule, ExamModeModule, RealtimeModule, CatalogModule, SpeechModule] })
export class ScriptModule {}

export async function withScriptContext<T>(fn: (app: INestApplicationContext) => Promise<T>): Promise<T> {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'], abortOnError: false });
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}
