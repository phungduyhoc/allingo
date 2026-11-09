/**
 * pnpm eval:build — (1) render prompt (system + user template Handlebars còn giữ {{...}} cho promptfoo) và xuất JSON Schema đầu ra
 * vào eval/prompts/*.txt và eval/schemas/*.json theo docs/spec/allingo-promptfoo.yaml;
 * (2) S5: dựng eval/data/explain_mcq_v1.jsonl (≥ 100 câu) từ ngân hàng published demo trong DB (bỏ qua với --no-data hoặc khi
 * DB không sẵn sàng – giữ tệp cũ). Dòng JSONL: {key, vars, gold:{correct_option}, meta} – `vars` khớp biến template explain_mcq.
 * (3) S169/C3: dựng eval/data/explain_mcq_ielts_v1.jsonl OFFLINE (không cần DB, chạy cả với --no-data) từ fixture IELTS tự biên soạn –
 * mọi dạng R/L nhiều mục × (không trả lời | trả lời sai | đúng một phần); `gold` = đáp án tóm tắt + từng mục.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPromptSpec } from '@allingo/db/seed';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const spec = loadPromptSpec();
const promptsDir = path.join(root, 'eval/prompts');
const schemasDir = path.join(root, 'eval/schemas');
const dataDir = path.join(root, 'eval/data');
fs.mkdirSync(promptsDir, { recursive: true });
fs.mkdirSync(schemasDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
for (const p of spec.prompts) {
  const system = p.system_prompt.replace('{{> common_system}}', spec.shared.common_system).replace('{{explain_locale_name}}', 'Vietnamese');
  const text = `[SYSTEM]\n${system.trim()}\n\n[USER]\n${p.user_template.trim()}\n`;
  fs.writeFileSync(path.join(promptsDir, `${p.code}.txt`), text);
  fs.writeFileSync(path.join(schemasDir, `${p.code}.json`), JSON.stringify(p.output_schema, null, 2));
}
process.stdout.write(`✔ eval:build: ${spec.prompts.length} prompt → eval/prompts, eval/schemas\n`);

{
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
  const { buildIeltsExplainDataset } = await import('./lib/explain-dataset.js');
  const lines = buildIeltsExplainDataset();
  fs.writeFileSync(path.join(dataDir, 'explain_mcq_ielts_v1.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const byType = lines.reduce<Record<string, number>>((m, l) => ({ ...m, [l.vars.question_type]: (m[l.vars.question_type] ?? 0) + 1 }), {});
  process.stdout.write(`✔ eval:build: ${lines.length} dòng IELTS → eval/data/explain_mcq_ielts_v1.jsonl ${JSON.stringify(byType)}\n`);
  if (lines.length < 50) process.stderr.write('⚠ explain_mcq_ielts_v1 < 50 dòng (S169)\n');
}

if (!process.argv.includes('--no-data')) {
  process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? 'mock';
  process.env.LOG_LEVEL = 'error';
  try {
    const { loadEnv } = await import('../src/config/env.js');
    const env = loadEnv();
    const { createApp } = await import('../src/bootstrap.js');
    const app = await createApp(env);
    await app.init();
    const { DbService } = await import('../src/shared/db/db.module.js');
    const { CatalogQueryService } = await import('../src/modules/catalog/index.js');
    const { buildExplainDataset } = await import('./lib/explain-dataset.js');
    const lines = await buildExplainDataset(app.get(DbService), app.get(CatalogQueryService));
    const out = path.join(dataDir, 'explain_mcq_v1.jsonl');
    fs.writeFileSync(out, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
    const bySection = lines.reduce<Record<string, number>>((m, l) => ({ ...m, [l.vars.section_code]: (m[l.vars.section_code] ?? 0) + 1 }), {});
    process.stdout.write(`✔ eval:build: ${lines.length} câu → eval/data/explain_mcq_v1.jsonl ${JSON.stringify(bySection)}\n`);
    if (lines.length < 100) process.stderr.write('⚠ explain_mcq_v1 < 100 câu – chạy pnpm db:seed --set demo trước\n');
    await app.close();
  } catch (err) {
    process.stderr.write(`⚠ eval:build: không dựng được dataset từ DB (${(err as Error).message}); giữ eval/data hiện có\n`);
  }
}
process.exit(0);
