// pnpm api:openapi → apps/api/openapi.generated.yaml (xuất từ NestJS, không khởi động listener)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { loadEnv } from '../src/config/env.js';

process.env.AI_PROVIDER = 'mock';
process.env.LOG_LEVEL = 'error';
const env = loadEnv();
const { createApp, buildOpenApiDocument } = await import('../src/bootstrap.js');
const app = await createApp(env);
await app.init();
const doc = buildOpenApiDocument(app);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../openapi.generated.yaml');
fs.writeFileSync(out, stringify(doc, { lineWidth: 0 }));
console.log(`✔ OpenAPI xuất ra ${out} (${Object.keys(doc.paths).length} đường dẫn)`);
await app.close();
process.exit(0);
