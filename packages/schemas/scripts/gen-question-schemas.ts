// Xuất JSON Schema (draft 2020-12) cho 12 dạng nội dung câu hỏi từ Zod → packages/schemas/schemas/question/<code>.json
// Chạy: pnpm --filter @allingo/schemas gen:question
//
// Ghi chú về z.toJSONSchema (Zod 4):
// - `z.record(keySchema, value)` xuất thành `propertyNames` (minLength/maxLength của key) + `additionalProperties` – đủ để validate.
// - `.default()` xuất thành `default`; `z.uuid()` thành `format: uuid`; `.catchall()` thành `additionalProperties`.
// - `io: 'input'` để mô tả JSON do tác giả soạn (trường có default là optional), đúng mục đích validate ở CMS/seed.
// - Các schema con dùng chung (option/item/media) được Zod tự gom vào `$defs` khi lặp lại; không cần reuseRefs ngoài.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { QUESTION_TYPE_CODES, questionContentSchemasByType } from '../src/question/content.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../schemas/question');
const BASE_ID = 'https://allingo.vn/schemas/question';

fs.mkdirSync(outDir, { recursive: true });

// Xoá tệp cũ không còn trong danh sách 12 dạng (tránh rác khi đổi tên)
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.json') && !QUESTION_TYPE_CODES.includes(f.replace(/\.json$/, '') as (typeof QUESTION_TYPE_CODES)[number])) {
    fs.rmSync(path.join(outDir, f));
  }
}

const title = (code: string) =>
  code
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

for (const code of QUESTION_TYPE_CODES) {
  const schema = questionContentSchemasByType[code];
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;

  const out = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${BASE_ID}/${code}.json`,
    title: `Allingo question content: ${title(code)}`,
    description: `Nội dung câu hỏi dạng "${code}" lưu trong catalog.question_versions.content (JSONB). Sinh tự động từ packages/schemas/src/question/content.ts – không sửa tay.`,
    ...Object.fromEntries(Object.entries(json).filter(([k]) => k !== '$schema')),
  };
  fs.writeFileSync(path.join(outDir, `${code}.json`), JSON.stringify(out, null, 2) + '\n');
}

console.log(`[gen:question] ${QUESTION_TYPE_CODES.length} JSON Schema → ${outDir}`);
