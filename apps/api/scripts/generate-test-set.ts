/**
 * Sinh đề mini lặp lại được từ ngân hàng câu đã phát hành (Sprint 4):
 *   pnpm --filter @allingo/api test-sets:generate --seed 42 [--program toeic] [--code toeic-mini-gen-42] [--draft] [--paid] [--blueprint path.json]
 * Cùng seed + cùng ngân hàng (bank_fingerprint) → cùng đề. Ghi catalog.test_sets kind=mini + audit `test_set.generated`.
 */
import 'reflect-metadata';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { miniBlueprintSchema } from '@allingo/schemas';
import { withScriptContext } from '../src/cli/script-context.js';
import { MiniTestService, generateTestSetInputSchema } from '../src/modules/catalog/index.js';

const { values } = parseArgs({
  options: {
    seed: { type: 'string' },
    program: { type: 'string', default: 'toeic' },
    code: { type: 'string' },
    blueprint: { type: 'string' },
    draft: { type: 'boolean', default: false },
    paid: { type: 'boolean', default: false },
  },
  strict: true,
});

const input = generateTestSetInputSchema.parse({
  program: values.program,
  seed: values.seed !== undefined ? Number(values.seed) : undefined,
  code: values.code,
  blueprint: values.blueprint ? miniBlueprintSchema.parse(JSON.parse(fs.readFileSync(values.blueprint, 'utf8'))) : undefined,
  publish: !values.draft,
  is_free: !values.paid,
});

const r = await withScriptContext((app) => app.get(MiniTestService).generate(input, { id: null, roles: ['cli'] }));
process.stdout.write(`✔ ${r.code} (${r.status}) – ${r.question_count} câu, seed ${r.seed}, bank ${r.bank_fingerprint}, ${Math.round(r.duration_sec / 60)} phút\n`);
process.stdout.write(`  theo Part: ${Object.entries(r.by_section).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
if (r.shortfall.length) process.stdout.write(`  ⚠ thiếu câu: ${r.shortfall.map((s) => `${s.section_code} ${s.selected}/${s.requested} (${s.reason})`).join('; ')}\n`);
process.stdout.write(`  test_set_id: ${r.test_set_id}\n`);
