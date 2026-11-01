import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Thống kê PoC GATE-1 (eval/poc/lib/stats.ts). Nạp động theo đường dẫn để tsc của apps/api không kéo eval/ vào
 * chương trình (eval/ nằm ngoài rootDir; typecheck riêng bằng `pnpm --filter @allingo/api poc:typecheck`).
 */
interface ThresholdCheck {
  key: string;
  metric: string;
  value: number | null;
  pass: boolean | null;
}
interface StatsModule {
  mae(p: Array<number | null>, t: Array<number | null>): number | null;
  withinRate(p: Array<number | null>, t: Array<number | null>, tol?: number): number | null;
  pearson(x: Array<number | null>, y: Array<number | null>): number | null;
  std(xs: number[], sample?: boolean): number | null;
  percentile(xs: number[], p: number): number | null;
  histogram(xs: number[]): Record<string, number>;
  checkThresholds(m: Record<string, number | null | undefined>, t: Record<string, number>, only?: string[]): ThresholdCheck[];
  mapPool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
let s: StatsModule;
beforeAll(async () => {
  s = (await import(pathToFileURL(path.resolve(here, '../../../../eval/poc/lib/stats.ts')).href)) as StatsModule;
});

describe('thống kê PoC (MAE, within 0,5, Pearson, độ lặp lại, phân vị)', () => {
  it('MAE và within_0_5 bỏ cặp thiếu', () => {
    const pred = [6, 5.5, 7, null, 8];
    const truth = [6.5, 5.5, 6, 7, 7.5];
    expect(s.mae(pred, truth)).toBeCloseTo((0.5 + 0 + 1 + 0.5) / 4, 10);
    expect(s.withinRate(pred, truth)).toBe(0.75);
    expect(s.mae([], [])).toBeNull();
    expect(() => s.mae([1], [1, 2])).toThrow();
  });

  it('Pearson: tương quan hoàn hảo/ngược/không xác định (phương sai 0 như mock)', () => {
    expect(s.pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(s.pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 10);
    expect(s.pearson([6, 6, 6], [5, 6, 7])).toBeNull();
    expect(s.pearson([1], [1])).toBeNull();
    // Giá trị tham chiếu tính tay: x=[1,2,3,4,5], y=[2,1,4,3,5] → r = 0.8
    expect(s.pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 10);
  });

  it('std mẫu (n−1) cho lặp lại, phân vị p50/p95 nội suy, histogram band', () => {
    expect(s.std([6, 6.5, 7])).toBeCloseTo(0.5, 10);
    expect(s.std([6])).toBeNull();
    expect(s.std([2, 4, 4, 4, 5, 5, 7, 9], false)).toBe(2);
    expect(s.percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(s.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBeCloseTo(9.55, 10);
    expect(s.histogram([6, 6.5, 6, 7])).toEqual({ '6.0': 2, '6.5': 1, '7.0': 1 });
  });

  it('đối chiếu eval.thresholds: _max → ≤, _min → ≥, thiếu số liệu → null; lọc khoá áp dụng', () => {
    const t = { mae_overall_max: 0.5, within_0_5_min: 0.8, pearson_min: 0.8, cost_usd_max: 0.06 };
    const c = s.checkThresholds({ mae_overall: 0.42, within_0_5: 0.75, pearson: null, cost_usd: 0.06 }, t);
    expect(Object.fromEntries(c.map((x) => [x.key, x.pass]))).toEqual({ mae_overall_max: true, within_0_5_min: false, pearson_min: null, cost_usd_max: true });
    expect(s.checkThresholds({ pearson: 0.9 }, t, ['pearson_min'])).toHaveLength(1);
  });

  it('mapPool giữ thứ tự và giới hạn song song', async () => {
    let active = 0;
    let peak = 0;
    const out = await s.mapPool([30, 10, 20, 5], 2, async (ms, i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30]);
    expect(peak).toBe(2);
  });
});
