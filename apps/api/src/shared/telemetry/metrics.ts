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

/** Collector chạy trước mỗi lần render (đọc độ sâu hàng đợi, kết nối DB…); lỗi/timeout của collector không chặn scrape */
export type Collector = () => Promise<void> | void;

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();
  private readonly collectors = new Map<string, Collector>();
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
  /** Đăng ký collector theo tên (đăng ký lại cùng tên → thay thế; tránh trùng khi nhiều instance Nest trong test) */
  registerCollector(name: string, fn: Collector): void {
    this.collectors.set(name, fn);
  }
  unregisterCollector(name: string): void {
    this.collectors.delete(name);
  }
  /** Chạy collectors (song song, mỗi cái ≤ timeoutMs) rồi render */
  async collectAndRender(timeoutMs = 2000): Promise<string> {
    await Promise.all(
      [...this.collectors.entries()].map(async ([name, fn]) => {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([Promise.resolve().then(fn), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), timeoutMs)))]);
        } catch {
          SELF_METRICS.collectorErrors.inc({ collector: name });
        } finally {
          if (timer) clearTimeout(timer);
        }
      }),
    );
    return this.render();
  }
  reset(): void {
    for (const m of this.metrics.values()) m.reset();
  }
  names(): string[] {
    return [...this.metrics.keys()];
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

/** Bucket độ trễ HTTP/DB (giây) – có mốc SLO 0,2 / 0,3 / 0,4 / 0,5 / 0,8 s (docs/slo.md) */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.8, 1, 2, 5, 10] as const;

export const SELF_METRICS = {
  collectorErrors: metrics.counter('metrics_collector_errors_total', 'Collector lỗi/timeout khi scrape', ['collector']),
};

/** RED theo route (S11): nhãn route = mẫu đường dẫn Fastify (`/v1/attempts/:attemptId/answers`), không URL thô */
export const HTTP_METRICS = {
  requests: metrics.counter('http_server_requests_total', 'Số request HTTP theo method/route/status', ['method', 'route', 'status']),
  duration: metrics.histogram('http_server_request_duration_seconds', 'Độ trễ request HTTP (giây) theo method/route/status', ['method', 'route', 'status'], LATENCY_BUCKETS),
  inflight: metrics.gauge('http_server_requests_in_flight', 'Request đang xử lý', []),
  rateLimited: metrics.counter('http_rate_limited_total', 'Request bị từ chối do giới hạn tốc độ theo bucket', ['bucket']),
};

/** BullMQ (S11): độ sâu theo trạng thái, tuổi job chờ lâu nhất, thời gian chờ/xử lý, thất bại, dead-letter */
export const QUEUE_METRICS = {
  jobs: metrics.gauge('bullmq_queue_jobs', 'Số job theo hàng đợi/trạng thái (waiting, active, delayed, failed, prioritized, waiting-children)', ['queue', 'state']),
  oldestWaiting: metrics.gauge('bullmq_queue_oldest_waiting_seconds', 'Tuổi job chờ lâu nhất (giây)', ['queue']),
  wait: metrics.histogram('bullmq_job_wait_seconds', 'Thời gian chờ từ lúc thêm tới lúc bắt đầu xử lý (giây)', ['queue', 'job'], [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 900]),
  duration: metrics.histogram('bullmq_job_duration_seconds', 'Thời gian xử lý job (giây)', ['queue', 'job', 'status'], [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]),
  failed: metrics.counter('bullmq_jobs_failed_total', 'Số lần job thất bại (mỗi lần thử)', ['queue', 'job']),
  deadletter: metrics.gauge('bullmq_deadletter_jobs', 'Số job trong ops.jobs_deadletter (24 giờ gần nhất)', ['queue']),
  deferred: metrics.counter('bullmq_jobs_deferred_total', 'Job ưu tiên thấp bị hoãn do backpressure', ['queue', 'job']),
  workerPaused: metrics.gauge('bullmq_worker_paused', '1 = worker hàng đợi đang tạm dừng do backpressure', ['queue']),
};

/** PostgreSQL (S11): kết nối theo trạng thái (pg_stat_activity), max_connections, độ trễ truy vấn, slow query */
export const DB_METRICS = {
  connections: metrics.gauge('db_connections', 'Kết nối tới DB hiện tại theo trạng thái (toàn server, pg_stat_activity)', ['state']),
  maxConnections: metrics.gauge('db_max_connections', 'max_connections của server', []),
  poolMax: metrics.gauge('db_pool_max', 'Kích thước pool cấu hình của process (DB_POOL_MAX)', ['pool']),
  queryDuration: metrics.histogram('db_query_duration_seconds', 'Độ trễ truy vấn (giây) theo loại câu lệnh/bảng chính', ['op', 'table'], LATENCY_BUCKETS),
  slowQueries: metrics.counter('db_slow_queries_total', 'Số truy vấn chậm hơn DB_SLOW_QUERY_MS', ['op', 'table']),
  queryErrors: metrics.counter('db_query_errors_total', 'Số truy vấn lỗi', ['op', 'table']),
  partitionMonthsAhead: metrics.gauge('db_partition_months_ahead', 'Số tháng tới đã có partition (0 = chỉ tháng hiện tại; < 0 = thiếu tháng hiện tại)', ['table']),
  databaseSize: metrics.gauge('db_database_size_bytes', 'Kích thước database hiện tại (bytes)', []),
};

/** Cache (S11): hit/miss theo loại cache (explain, stats, flags, dictionary) */
export const CACHE_METRICS = {
  requests: metrics.counter('cache_requests_total', 'Tra cache theo loại/kết quả (hit, miss)', ['cache', 'result']),
};

/** Thanh toán & webhook (S11 – dashboard Billing, alert webhook thất bại) */
export const BILLING_METRICS = {
  orders: metrics.counter('billing_orders_total', 'Đơn hàng tạo mới theo cổng', ['provider']),
  webhooks: metrics.counter('billing_webhooks_total', 'Webhook/IPN theo cổng/kết quả (ok, duplicate, invalid_signature, error)', ['provider', 'result']),
  providerCalls: metrics.histogram('billing_provider_call_duration_seconds', 'Gọi API cổng thanh toán/hoá đơn (giây)', ['provider', 'op', 'status'], [0.1, 0.25, 0.5, 1, 2, 5, 10, 20]),
  reconcileMismatches: metrics.counter('billing_reconcile_mismatches_total', 'Số giao dịch lệch khi đối soát', ['provider']),
};

/** Feature flag & báo lỗi */
export const OPS_METRICS = {
  flagEvaluations: metrics.counter('feature_flag_evaluations_total', 'Đánh giá feature flag theo key/kết quả', ['key', 'result']),
  errorsReported: metrics.counter('errors_reported_total', 'Lỗi gửi ErrorReporter (Sentry) theo nguồn', ['source']),
  processStart: metrics.gauge('process_start_time_seconds', 'Thời điểm khởi động process (unix giây)', []),
  memory: metrics.gauge('process_resident_memory_bytes', 'RSS của process (bytes)', []),
  heap: metrics.gauge('nodejs_heap_used_bytes', 'Heap V8 đang dùng (bytes)', []),
  eventLoopLag: metrics.gauge('nodejs_eventloop_lag_p99_seconds', 'Độ trễ event loop p99 (giây) trong cửa sổ 10 giây', []),
  info: metrics.gauge('allingo_build_info', 'Thông tin build (giá trị luôn 1)', ['service', 'version', 'env']),
};

/** S12 – beta kín & hỗ trợ: đăng ký chờ, mời/đổi mã, góp ý, SLA (alert SupportSlaBreached đọc gauge) */
export const GROWTH_METRICS = {
  waitlist: metrics.counter('beta_waitlist_signups_total', 'Đăng ký danh sách chờ mới theo chương trình', ['program']),
  betaInvites: metrics.counter('beta_invites_total', 'Lời mời beta theo kết quả (sent, failed, redeemed)', ['result']),
  feedback: metrics.counter('feedback_submitted_total', 'Góp ý in-app / báo lỗi câu / ticket theo loại', ['kind']),
  slaOverdue: metrics.gauge('support_sla_overdue', 'Số mục quá hạn SLA (content_report 48 giờ, support_ticket phản hồi đầu 24 giờ)', ['kind']),
};
