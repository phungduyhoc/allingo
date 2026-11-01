/**
 * Ngưỡng eval (allingo-prompts.yaml `eval.thresholds`): khoá `<metric>_min` / `<metric>_max`.
 * Metric thiếu trong kết quả → KHÔNG đạt (không suy đoán). Dùng chung cho runner eval và cổng kích hoạt prompt (S5).
 */
export interface ThresholdCheck {
  key: string;
  metric: string;
  op: 'min' | 'max';
  threshold: number;
  actual: number | null;
  ok: boolean;
}

export function checkThresholds(metrics: Record<string, unknown>, thresholds: Record<string, unknown> | null | undefined): { ok: boolean; checks: ThresholdCheck[] } {
  const checks: ThresholdCheck[] = [];
  for (const [key, raw] of Object.entries(thresholds ?? {})) {
    const m = /^(.+)_(min|max)$/.exec(key);
    if (!m || typeof raw !== 'number') continue;
    const metric = m[1]!;
    const op = m[2] as 'min' | 'max';
    const v = metrics[metric];
    const actual = typeof v === 'number' && Number.isFinite(v) ? v : null;
    const ok = actual !== null && (op === 'min' ? actual >= raw : actual <= raw);
    checks.push({ key, metric, op, threshold: raw, actual, ok });
  }
  return { ok: checks.length > 0 && checks.every((c) => c.ok), checks };
}

/** Ngưỡng bắt buộc thêm ngoài YAML theo task (sprint prompt S5: explain_mcq correct_option_match = 100 %) */
export const EXTRA_THRESHOLDS: Record<string, Record<string, number>> = {
  explain_mcq: { correct_option_match_min: 1, schema_valid_min: 1 },
};

export function thresholdsFor(taskCode: string, fromPolicy: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(fromPolicy ?? {})) if (typeof v === 'number') out[k] = v;
  return { ...out, ...(EXTRA_THRESHOLDS[taskCode] ?? {}) };
}
