/**
 * Registry Prometheus tối giản (text exposition format 0.0.4) – không thêm thư viện (prom-client) cho Sprint 5 (ADR-0026).
 * Một registry cho mỗi process; GET /v1/metrics render toàn bộ. Nhãn KHÔNG chứa dữ liệu người dùng (chỉ task/model/provider).
 */
type Labels = Record<string, string>;

const escapeLabel = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const keyOf = (names: readonly string[], labels: Labels) => names.map((n) => `${n}=${labels[n] ?? ''}`).join('\u0001');
const fmtLabels = (names: readonly string[], labels: Labels, extra?: [string, string]) => {
  const parts = names.map((n) => `${n}="${escapeLabel(labels[n] ?? '')}"`);
  if (extra) parts.push(`${extra[0]}="${escapeLabel(extra[1])}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};
const fmtNum = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e9) / 1e9) : v > 0 ? '+Inf' : '-Inf');

interface Metric {
  render(): string;
  reset(): void;
}

export class Counter implements Metric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
  ) {}
  inc(labels: Labels = {}, value = 1): void {
    if (!(value >= 0)) return;
    const k = keyOf(this.labelNames, labels);
    const cur = this.values.get(k) ?? { labels, value: 0 };
    cur.value += value;
    this.values.set(k, cur);
  }
  get(labels: Labels = {}): number {
    return this.values.get(keyOf(this.labelNames, labels))?.value ?? 0;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) lines.push(`${this.name}${fmtLabels(this.labelNames, labels)} ${fmtNum(value)}`);
    return lines.join('\n');
  }
  reset(): void {
    this.values.clear();
  }
}

export class Gauge implements Metric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
  ) {}
  set(labels: Labels, value: number): void {
    this.values.set(keyOf(this.labelNames, labels), { labels, value });
  }
  get(labels: Labels = {}): number | undefined {
    return this.values.get(keyOf(this.labelNames, labels))?.value;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) lines.push(`${this.name}${fmtLabels(this.labelNames, labels)} ${fmtNum(value)}`);
    return lines.join('\n');
  }
  reset(): void {
    this.values.clear();
  }
}

export class Histogram implements Metric {
  private readonly series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
    readonly buckets: readonly number[],
  ) {}
  observe(labels: Labels, value: number): void {
    if (!Number.isFinite(value)) return;
    const k = keyOf(this.labelNames, labels);
    const s = this.series.get(k) ?? { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
    this.buckets.forEach((b, i) => {
      if (value <= b) s.counts[i]!++;
    });
    s.sum += value;
    s.count++;
    this.series.set(k, s);
  }
  count(labels: Labels = {}): number {
    return this.series.get(keyOf(this.labelNames, labels))?.count ?? 0;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      this.buckets.forEach((b, i) => lines.push(`${this.name}_bucket${fmtLabels(this.labelNames, s.labels, ['le', fmtNum(b)])} ${s.counts[i]}`));
      lines.push(`${this.name}_bucket${fmtLabels(this.labelNames, s.labels, ['le', '+Inf'])} ${s.count}`);
      lines.push(`${this.name}_sum${fmtLabels(this.labelNames, s.labels)} ${fmtNum(s.sum)}`);
      lines.push(`${this.name}_count${fmtLabels(this.labelNames, s.labels)} ${s.count}`);
    }
    return lines.join('\n');
  }
  reset(): void {
    this.series.clear();
  }
}

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();
  private register<T extends Metric & { name: string }>(m: T): T {
    const existing = this.metrics.get(m.name);
    if (existing) return existing as T;
    this.metrics.set(m.name, m);
    return m;
  }
  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    return this.register(new Counter(name, help, labelNames));
  }
  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    return this.register(new Gauge(name, help, labelNames));
  }
  histogram(name: string, help: string, labelNames: readonly string[], buckets: readonly number[]): Histogram {
    return this.register(new Histogram(name, help, labelNames, buckets));
  }
  render(): string {
    return `${[...this.metrics.values()].map((m) => m.render()).join('\n')}\n`;
  }
  reset(): void {
    for (const m of this.metrics.values()) m.reset();
  }
}

/** Registry của process */
export const metrics = new MetricsRegistry();

/** Metrics AI Gateway (S5): thời lượng, chi phí, lỗi theo task/model; token; cache hit; trạng thái breaker */
export const AI_METRICS = {
  duration: metrics.histogram('ai_task_duration_seconds', 'Thời lượng tác vụ AI (giây) theo task/model/status', ['task', 'model', 'status'], [0.1, 0.25, 0.5, 1, 2, 4, 6, 10, 20, 45, 90]),
  cost: metrics.counter('ai_task_cost_usd_total', 'Tổng chi phí USD ước tính theo task/model', ['task', 'model']),
  failures: metrics.counter('ai_task_failures_total', 'Số tác vụ AI thất bại (failed/timeout) theo task/model', ['task', 'model']),
  tokens: metrics.counter('ai_task_tokens_total', 'Token vào/ra theo task/model', ['task', 'model', 'direction']),
  cacheHits: metrics.counter('ai_task_cache_hits_total', 'Số lần trúng cache (không gọi model) theo task', ['task']),
  fallbacks: metrics.counter('ai_task_fallbacks_total', 'Số tác vụ thành công bằng model dự phòng theo task/model', ['task', 'model']),
  breakerState: metrics.gauge('ai_provider_circuit_state', 'Trạng thái circuit breaker theo provider: 0 closed, 1 half_open, 2 open', ['provider']),
  retries: metrics.counter('ai_provider_retries_total', 'Số lần retry lỗi tạm thời theo provider', ['provider']),
};
