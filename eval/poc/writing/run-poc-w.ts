/**
 * PoC-W (GATE-1): chấm IELTS Writing bằng `grade_writing_ielts` qua AiGateway với nhiều model route, so với band giáo viên.
 * Chạy: pnpm --filter @allingo/api poc:w   (AI_PROVIDER=mock → chỉ kiểm chứng harness; live → cần API key)
 *
 * Biến môi trường (chỉ dùng cho script này):
 *   POC_W_DATASET        đường dẫn JSONL (mặc định eval/poc/writing/dataset.sample.jsonl) – định dạng dataset.schema.json
 *   POC_W_MODELS         danh sách alias, phân tách bằng dấu phẩy (mặc định anthropic:claude-sonnet,openai:gpt,google:gemini-pro)
 *   POC_W_REPEATS        số lần chạy lặp để đo độ ổn định (mặc định 3)
 *   POC_W_REPEAT_SUBSET  số bài đầu tiên dùng cho đo lặp (mặc định 40)
 *   POC_W_LIMIT          giới hạn số bài (0 = tất cả)
 *   POC_W_CONCURRENCY    số lời gọi song song (mặc định 2)
 *   POC_W_OUT            thư mục kết quả (mặc định eval/poc/writing/results)
 * Ghi đè model chỉ trong tiến trình này (bọc TaskRegistry.resolve), không sửa ai.model_routes. Mọi lời gọi vẫn đi qua
 * AiGateway.runTask (validate Zod, metering ai.ai_tasks với user_id = null, không trừ credit).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkThresholds, mae, mapPool, mean, pearson, percentile, round, std, withinRate, wordCount } from '../lib/stats.js';
import { envInt, printTable, readJsonl, thresholdsFor, writeResult } from '../lib/common.js';
import { loadEnv } from '../../../apps/api/src/config/env.js';
import { AiGatewayService, AiTaskFailedError, TaskRegistry } from '../../../apps/api/src/modules/ai-gateway/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CRITERIA = ['task', 'coherence_cohesion', 'lexical_resource', 'grammatical_range_accuracy'] as const;
type Criterion = (typeof CRITERIA)[number];
type Bands = Record<Criterion, number> & { overall: number };

interface DatasetItem {
  id: string;
  task_type: 'task2' | 'task1_academic' | 'task1_general';
  prompt_text: string;
  image_description?: string | null;
  essay_text: string;
  target_band?: number;
  source: string;
  band_source: 'teacher' | 'assumed';
  teacher_bands: Array<Bands & { rater: string }>;
}

interface GradeOutput {
  overall: number;
  criterion_scores: Record<Criterion, number>;
  flags: Record<string, boolean>;
  confidence: string;
}

interface Run {
  ok: boolean;
  overall: number | null;
  criteria: Partial<Record<Criterion, number>>;
  latencyMs: number;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  model: string | null;
  provider: string | null;
  fallbackUsed: boolean;
  repaired: boolean;
  flags?: Record<string, boolean>;
  error?: string;
}

/** Kiểm tra tối thiểu theo dataset.schema.json (không có ajv trong eval/) */
function validateItem(v: DatasetItem, line: number): string[] {
  const errs: string[] = [];
  const band = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 9 && Math.abs(x * 2 - Math.round(x * 2)) < 1e-9;
  if (!v.id || typeof v.id !== 'string') errs.push('id');
  if (!['task2', 'task1_academic', 'task1_general'].includes(v.task_type)) errs.push('task_type');
  if (typeof v.prompt_text !== 'string' || v.prompt_text.length < 20) errs.push('prompt_text');
  if (typeof v.essay_text !== 'string' || v.essay_text.length < 20) errs.push('essay_text');
  if (v.task_type === 'task1_academic' && !v.image_description) errs.push('image_description (bắt buộc với task1_academic)');
  if (!['teacher', 'assumed'].includes(v.band_source)) errs.push('band_source');
  if (!Array.isArray(v.teacher_bands) || v.teacher_bands.length === 0) errs.push('teacher_bands');
  for (const t of v.teacher_bands ?? []) for (const k of ['overall', ...CRITERIA] as const) if (!band(t[k])) errs.push(`teacher_bands.${t.rater}.${k}`);
  return errs.map((e) => `dòng ${line}: thiếu/sai ${e}`);
}

const avgBands = (ts: Bands[]): Bands => {
  const m = (k: keyof Bands) => mean(ts.map((t) => t[k]))!;
  return { overall: m('overall'), task: m('task'), coherence_cohesion: m('coherence_cohesion'), lexical_resource: m('lexical_resource'), grammatical_range_accuracy: m('grammatical_range_accuracy') };
};

async function main(): Promise<void> {
  process.env.LOG_LEVEL ??= 'warn';
  const env = loadEnv();
  const datasetPath = path.resolve(process.env.POC_W_DATASET ?? path.join(here, 'dataset.sample.jsonl'));
  const models = (process.env.POC_W_MODELS ?? 'anthropic:claude-sonnet,openai:gpt,google:gemini-pro').split(',').map((s) => s.trim()).filter(Boolean);
  const repeats = envInt('POC_W_REPEATS', 3, 1);
  const repeatSubset = envInt('POC_W_REPEAT_SUBSET', 40, 0);
  const limit = envInt('POC_W_LIMIT', 0, 0);
  const concurrency = envInt('POC_W_CONCURRENCY', 2, 1);
  const outDir = path.resolve(process.env.POC_W_OUT ?? path.join(here, 'results'));

  const rows = readJsonl<DatasetItem>(datasetPath);
  const errors = rows.flatMap((r) => validateItem(r.value, r.line));
  if (errors.length) throw new Error(`Dataset không hợp lệ:\n  ${errors.join('\n  ')}`);
  const items = rows.map((r) => r.value).slice(0, limit || undefined);
  const { evalSet, thresholds } = thresholdsFor('grade_writing_ielts');
  const truth = items.map((it) => avgBands(it.teacher_bands));
  const twoRaters = items.filter((it) => it.teacher_bands.length >= 2);
  const interRater = twoRaters.length
    ? { n: twoRaters.length, mae_overall: round(mae(twoRaters.map((i) => i.teacher_bands[0]!.overall), twoRaters.map((i) => i.teacher_bands[1]!.overall))), within_0_5: round(withinRate(twoRaters.map((i) => i.teacher_bands[0]!.overall), twoRaters.map((i) => i.teacher_bands[1]!.overall))) }
    : null;
  const bandSources = items.reduce<Record<string, number>>((a, it) => ({ ...a, [it.band_source]: (a[it.band_source] ?? 0) + 1 }), {});

  const { createApp } = await import('../../../apps/api/src/bootstrap.js');
  const app = await createApp(env);
  await app.init();
  const gateway = app.get(AiGatewayService);
  const registry = app.get(TaskRegistry);
  // Ghi đè route model trong tiến trình (primary = alias đang thử, không fallback) để so sánh từng model độc lập
  let override: string | null = null;
  const originalResolve = registry.resolve.bind(registry);
  registry.resolve = async (...args: Parameters<TaskRegistry['resolve']>) => {
    const t = await originalResolve(...args);
    return t && override ? { ...t, route: { ...t.route, primaryModel: override, fallbackModels: [] } } : t;
  };

  const gradeOnce = async (it: DatasetItem): Promise<Run> => {
    const started = Date.now();
    try {
      const r = await gateway.runTask<GradeOutput>({
        taskCode: 'grade_writing_ielts',
        userId: null,
        chargeCredits: false,
        program: 'ielts',
        locale: 'vi',
        inputRef: { purpose: 'poc_w', item_id: it.id },
        variables: { task_type: it.task_type, min_words: it.task_type === 'task2' ? 250 : 150, word_count: wordCount(it.essay_text), target_band: it.target_band ?? 7, explain_locale: 'vi', prompt_text: it.prompt_text, image_description: it.image_description ?? '', essay_text: it.essay_text },
      });
      return { ok: true, overall: r.data.overall, criteria: r.data.criterion_scores, latencyMs: r.latencyMs, costUsd: r.costUsd, tokensIn: r.tokensIn, tokensOut: r.tokensOut, model: r.model?.modelId ?? null, provider: r.model?.provider ?? null, fallbackUsed: r.fallbackUsed, repaired: r.repaired, flags: r.data.flags };
    } catch (err) {
      const reason = err instanceof AiTaskFailedError ? `${err.reason}: ${err.message}` : (err as Error).message;
      return { ok: false, overall: null, criteria: {}, latencyMs: Date.now() - started, costUsd: null, tokensIn: null, tokensOut: null, model: null, provider: null, fallbackUsed: false, repaired: false, error: reason.slice(0, 300) };
    }
  };

  const results = [];
  for (const alias of models) {
    override = alias;
    process.stdout.write(`▶ ${alias}: ${items.length} bài × 1 + ${Math.min(repeatSubset, items.length)} bài × ${repeats - 1} lần lặp…\n`);
    const first = await mapPool(items, concurrency, (it) => gradeOnce(it));
    const live = env.AI_PROVIDER === 'live';
    const fellBackToMock = live && first.some((r) => r.ok && r.provider === 'mock');
    const subset = items.slice(0, Math.min(repeatSubset, items.length));
    const repeatRuns: Run[][] = subset.map((_, i) => [first[i]!]);
    if (!fellBackToMock && repeats > 1) {
      for (let k = 1; k < repeats; k++) {
        const again = await mapPool(subset, concurrency, (it) => gradeOnce(it));
        again.forEach((r, i) => repeatRuns[i]!.push(r));
      }
    }
    const pred = first.map((r) => r.overall);
    const criterionMae = Object.fromEntries(CRITERIA.map((c) => [c, round(mae(first.map((r) => r.criteria[c] ?? null), truth.map((t) => t[c])))])) as Record<Criterion, number | null>;
    const stdPerItem = repeatRuns.map((rs) => std(rs.filter((r) => r.ok).map((r) => r.overall!))).filter((x): x is number => x !== null);
    const okRuns = [...first, ...repeatRuns.flatMap((rs) => rs.slice(1))].filter((r) => r.ok);
    const latencies = okRuns.map((r) => r.latencyMs);
    const costs = okRuns.map((r) => r.costUsd).filter((c): c is number => c !== null);
    const criterionValues = Object.values(criterionMae).filter((x): x is number => x !== null);
    const metrics = {
      n_items: items.length,
      n_ok: first.filter((r) => r.ok).length,
      n_failed: first.filter((r) => !r.ok).length,
      mae_overall: round(mae(pred, truth.map((t) => t.overall))),
      within_0_5: round(withinRate(pred, truth.map((t) => t.overall))),
      pearson: round(pearson(pred, truth.map((t) => t.overall))),
      criterion_mae: criterionValues.length ? Math.max(...criterionValues) : null,
      criterion_mae_by: criterionMae,
      consistency_std: round(mean(stdPerItem)),
      consistency_items: stdPerItem.length,
      consistency_repeats: repeats,
      cost_usd: round(mean(costs), 5),
      cost_usd_total: round(costs.reduce((a, b) => a + b, 0), 4),
      latency_p50_ms: round(percentile(latencies, 0.5), 0),
      latency_p95_ms: round(percentile(latencies, 0.95), 0),
      tokens_in_mean: round(mean(okRuns.map((r) => r.tokensIn ?? 0)), 0),
      tokens_out_mean: round(mean(okRuns.map((r) => r.tokensOut ?? 0)), 0),
      fallback_or_repair: okRuns.filter((r) => r.fallbackUsed || r.repaired).length,
    };
    const { criterion_mae_by: _by, ...numeric } = metrics;
    const checks = checkThresholds(numeric, thresholds);
    const effective = [...new Set(okRuns.map((r) => `${r.provider}:${r.model}`))];
    const isMock = env.AI_PROVIDER === 'mock' || fellBackToMock;
    const allTeacher = (bandSources.teacher ?? 0) === items.length;
    const verdict = isMock ? 'mock_only' : !allTeacher ? 'insufficient_data' : checks.every((c) => c.pass === true) ? 'go' : 'no_go';
    results.push({
      model_alias: alias,
      effective_models: effective,
      status: fellBackToMock ? 'not_configured (provider thiếu API key → router rơi về mock)' : 'ran',
      metrics,
      checks,
      verdict,
      failures: first.flatMap((r, i) => (r.ok ? [] : [{ item: items[i]!.id, error: r.error }])),
      items: items.map((it, i) => ({ id: it.id, task_type: it.task_type, truth: truth[i], pred_overall: first[i]!.overall, pred_criteria: first[i]!.criteria, repeats: repeatRuns[i]?.map((r) => r.overall) ?? null, latency_ms: first[i]!.latencyMs, cost_usd: first[i]!.costUsd, flags: first[i]!.flags ?? null })),
    });
  }
  registry.resolve = originalResolve;
  await app.close();

  const report = {
    poc: 'PoC-W',
    task_code: 'grade_writing_ielts',
    generated_at: new Date().toISOString(),
    ai_provider: env.AI_PROVIDER,
    disclaimer:
      env.AI_PROVIDER === 'mock'
        ? 'AI_PROVIDER=mock: kết quả chỉ kiểm chứng harness (MockProvider trả band cố định), KHÔNG phải số liệu chấm thật.'
        : (bandSources.assumed ?? 0) > 0
          ? 'Dataset có band GIẢ ĐỊNH (band_source = assumed): không dùng để kết luận GATE-1.'
          : null,
    dataset: { path: path.relative(process.cwd(), datasetPath), n: items.length, band_sources: bandSources, task_types: items.reduce<Record<string, number>>((a, it) => ({ ...a, [it.task_type]: (a[it.task_type] ?? 0) + 1 }), {}), inter_rater: interRater },
    config: { models, repeats, repeat_subset: Math.min(repeatSubset, items.length), concurrency },
    eval_set: evalSet,
    thresholds,
    results,
  };
  const file = writeResult(outDir, report);
  printTable(results.map((r) => ({ model: r.model_alias, effective: r.effective_models.join(','), n_ok: `${r.metrics.n_ok}/${r.metrics.n_items}`, mae: r.metrics.mae_overall, within_0_5: r.metrics.within_0_5, pearson: r.metrics.pearson, std: r.metrics.consistency_std, cost_usd: r.metrics.cost_usd, p95_ms: r.metrics.latency_p95_ms, verdict: r.verdict })));
  if (report.disclaimer) process.stdout.write(`⚠ ${report.disclaimer}\n`);
  process.stdout.write(`✔ PoC-W: ${file}\n`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`✘ PoC-W lỗi: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
