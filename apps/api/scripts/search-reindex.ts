/**
 * Dựng lại chỉ mục tìm kiếm (Meilisearch) từ catalog: `pnpm --filter @allingo/api search:reindex`.
 * SEARCH_PROVIDER=pg → không làm gì (PostgreSQL truy vấn trực tiếp).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '../src/worker/worker.module.js';
import { SearchService } from '../src/modules/catalog/index.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
try {
  const n = await app.get(SearchService).reindexAll();
  process.stdout.write(`✔ đã index ${n} câu hỏi đã phát hành\n`);
} finally {
  await app.close();
}
