/**
 * Thống kê cho PoC GATE-1 (không phụ thuộc thư viện ngoài). Mọi hàm trả `null` khi không đủ dữ liệu
 * thay vì NaN để báo cáo JSON rõ ràng.
 */

export const round = (x: number | null, d = 3): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Độ lệch chuẩn; `sample = true` dùng n−1 (mặc định cho độ lặp lại giữa các lần chạy) */
export function std(xs: number[], sample = true): number | null {
  const n = xs.length;
  if (n === 0 || (sample && n < 2)) return null;
  const m = mean(xs)!;
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  return Math.sqrt(ss / (sample ? n - 1 : n));
}

function pairs(pred: Array<number | null>, truth: Array<number | null>): Array<[number, number]> {
  if (pred.length !== truth.length) throw new Error('pred/truth length mismatch');
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pred.length; i++) {
    const p = pred[i];
    const t = truth[i];
    if (typeof p === 'number' && typeof t === 'number' && Number.isFinite(p) && Number.isFinite(t)) out.push([p, t]);
  }
  return out;
}

/** Sai số tuyệt đối trung bình (bỏ cặp thiếu) */
export function mae(pred: Array<number | null>, truth: Array<number | null>): number | null {
  const ps = pairs(pred, truth);
  return ps.length === 0 ? null : ps.reduce((a, [p, t]) => a + Math.abs(p - t), 0) / ps.length;
}

/** Tỉ lệ |pred − truth| ≤ tol (mặc định 0,5 band) */
export function withinRate(pred: Array<number | null>, truth: Array<number | null>, tol = 0.5): number | null {
  const ps = pairs(pred, truth);
  return ps.length === 0 ? null : ps.filter(([p, t]) => Math.abs(p - t) <= tol + 1e-9).length / ps.length;
}

/** Hệ số tương quan Pearson; null khi < 2 cặp hoặc một bên phương sai 0 (vd mock trả hằng số) */
export function pearson(x: Array<number | null>, y: Array<number | null>): number | null {
  const ps = pairs(x, y);
  if (ps.length < 2) return null;
  const mx = mean(ps.map((p) => p[0]))!;
  const my = mean(ps.map((p) => p[1]))!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [a, b] of ps) {
    sxy += (a - mx) * (b - my);
    sxx += (a - mx) ** 2;
    syy += (b - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Phân vị nội suy tuyến tính (kiểu R-7), p ∈ [0,1] */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo]! + (h - lo) * (s[hi]! - s[lo]!);
}

export interface Distribution {
  n: number;
  mean: number | null;
  std: number | null;
  min: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  max: number | null;
}

export function summarize(xs: number[], digits = 2): Distribution {
  return {
    n: xs.length,
    mean: round(mean(xs), digits),
    std: round(std(xs, false), digits),
    min: xs.length ? round(Math.min(...xs), digits) : null,
    p10: round(percentile(xs, 0.1), digits),
    p50: round(percentile(xs, 0.5), digits),
    p90: round(percentile(xs, 0.9), digits),
    max: xs.length ? round(Math.max(...xs), digits) : null,
  };
}

/** Đếm theo giá trị (vd band 3.5…9) – khoá sắp xếp tăng dần */
export function histogram(values: number[]): Record<string, number> {
  const m = new Map<number, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k.toFixed(1), v]));
}

export interface ThresholdCheck {
  key: string;
  metric: string;
  value: number | null;
  threshold: number;
  op: '<=' | '>=';
  /** null = chưa đủ dữ liệu để kết luận */
  pass: boolean | null;
}

/**
 * Đối chiếu ngưỡng `eval.thresholds` (khoá kết thúc `_max` → ≤, `_min` → ≥; tên metric = khoá bỏ hậu tố).
 * `only` giới hạn khoá áp dụng (PoC-P chỉ dùng một phần ngưỡng của ielts_speaking_v1).
 */
export function checkThresholds(metrics: Record<string, number | null | undefined>, thresholds: Record<string, number>, only?: string[]): ThresholdCheck[] {
  const out: ThresholdCheck[] = [];
  for (const [key, threshold] of Object.entries(thresholds)) {
    if (only && !only.includes(key)) continue;
    const m = /^(.*)_(max|min)$/.exec(key);
    if (!m) continue;
    const metric = m[1]!;
    const op = m[2] === 'max' ? '<=' : '>=';
    const raw = metrics[metric];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    out.push({ key, metric, value, threshold, op, pass: value === null ? null : op === '<=' ? value <= threshold + 1e-12 : value >= threshold - 1e-12 });
  }
  return out;
}

/** Chạy song song giới hạn `limit` tác vụ, giữ thứ tự kết quả */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}
