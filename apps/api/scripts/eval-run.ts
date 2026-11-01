/**
 * pnpm eval:run — chạy eval explain_mcq (S5) và LƯU ai.eval_runs/eval_run_items.
 * - Mặc định: runner TypeScript qua AiGateway (provider theo AI_PROVIDER; mock → run đánh dấu `metrics.mock = true`, `passed = false`).
 * - `--engine promptfoo`: chạy `promptfoo eval --config docs/spec/allingo-promptfoo.yaml` nếu đã cài promptfoo (cần khoá AI thật).
 * Tuỳ chọn: --limit N · --prompt-version <uuid> (mặc định phiên bản active) · --dataset eval/data/explain_mcq_v1.jsonl
 * Kết quả: eval/results/explain_mcq_v1.latest.json + bảng tóm tắt (kèm chi phí ước tính / 1.000 explain theo bảng giá model).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const out = (s: string) => process.stdout.write(`${s}\n`);

if (arg('--engine') === 'promptfoo') {
  const r = spawnSync('npx', ['--no-install', 'promptfoo', 'eval', '--config', 'docs/spec/allingo-promptfoo.yaml', '--filter-pattern', 'explain_mcq'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.stderr.write('✘ promptfoo không chạy được (chưa cài hoặc thiếu khoá) – dùng runner TS mặc định: pnpm eval:run\n');
  process.exit(r.status ?? 1);
}

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
const { loadEnv } = await import('../src/config/env.js');
const env = loadEnv();
const datasetPath = path.resolve(root, arg('--dataset') ?? 'eval/data/explain_mcq_v1.jsonl');
if (!fs.existsSync(datasetPath)) {
  process.stderr.write(`✘ thiếu ${datasetPath} – chạy pnpm eval:build trước\n`);
  process.exit(1);
}
const { createApp } = await import('../src/bootstrap.js');
const app = await createApp(env);
await app.init();
const { AiGatewayService, EvalService, explainEvalLineSchema } = await import('../src/modules/ai-gateway/index.js');
const evals = app.get(EvalService);
const raw = fs.readFileSync(datasetPath, 'utf8').split('\n').filter((l) => l.trim());
const lines = raw.map((l, i) => {
  const r = explainEvalLineSchema.safeParse(JSON.parse(l));
  if (!r.success) throw new Error(`dòng ${i + 1} không hợp lệ: ${r.error.issues[0]?.message}`);
  return r.data;
});
const limit = arg('--limit') ? Number(arg('--limit')) : undefined;
const versionId = arg('--prompt-version') ?? (await app.get(AiGatewayService).currentPromptVersionId('explain_mcq', null, null));
if (!versionId) throw new Error('Không có phiên bản explain_mcq active');
const imported = await evals.importExplainDataset(lines, { promptVersionId: versionId });
const runId = await evals.createRun(imported.evalSetId, versionId, null, 'cli');
out(`▶ eval explain_mcq_v1: ${limit ?? lines.length}/${lines.length} câu · prompt_version ${versionId} · provider ${env.AI_PROVIDER}${evals.isMock ? ' (MOCK – không tính là đạt ngưỡng thật)' : ''}`);
const res = await evals.executeRun(runId, { limit });
const m = res.metrics;
fs.mkdirSync(path.join(root, 'eval/results'), { recursive: true });
fs.writeFileSync(path.join(root, 'eval/results/explain_mcq_v1.latest.json'), JSON.stringify({ ...res, dataset: path.relative(root, datasetPath), imported }, null, 2));
const rows: Array<[string, unknown]> = [
  ['run_id', res.run_id],
  ['mock', m.mock],
  ['n', m.n],
  ['schema_valid', m.schema_valid],
  ['correct_option_match', m.correct_option_match],
  ['covers_all_distractors', m.covers_all_distractors],
  ['teacher_rating_mean', `${String(m.teacher_rating_mean)} (${String(m.teacher_proxy_rating_judge)})`],
  ['factual_error_rate', m.factual_error_rate],
  ['latency_p95_ms', m.latency_p95_ms],
  ['cost_usd / câu', `${String(m.cost_usd)}${m.cost_usd_is_estimate ? ' (ước tính)' : ''}`],
  ['≈ chi phí / 1.000 explain (USD)', `${String(m.est_cost_per_1000_explain_usd)} @ ${JSON.stringify((m.est_cost_basis as { primary_model?: string })?.primary_model)}`],
  ['would_pass (ngưỡng YAML)', m.would_pass],
  ['passed (lưu DB)', res.passed],
];
for (const [k, v] of rows) out(`  ${k.padEnd(34)} ${String(v)}`);
for (const c of (m.threshold_checks as Array<{ key: string; actual: number | null; threshold: number; ok: boolean }>) ?? []) out(`    ${c.ok ? '✔' : '✘'} ${c.key} = ${String(c.actual)} (ngưỡng ${c.threshold})`);
out(`✔ đã lưu ai.eval_runs ${res.run_id} + ${String(m.n)} eval_run_items; báo cáo: eval/results/explain_mcq_v1.latest.json`);
await app.close();
process.exit(0);
