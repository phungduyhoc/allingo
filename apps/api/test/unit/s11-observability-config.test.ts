import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { metrics } from '../../src/shared/telemetry/metrics.js';

/**
 * S11 – validator cấu hình quan sát as code (không cần Docker/Prometheus): alert rules có severity/summary/runbook_url trỏ
 * tệp runbook có thật; đủ alert bắt buộc của S11; 6 dashboard JSON hợp lệ; mọi metric trong biểu thức dashboard/alert tồn tại
 * trong registry của API (hoặc exporter chuẩn / recording rule). CI chạy thêm `promtool check rules|test rules`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const obs = path.join(root, 'infra/observability');
const read = (p: string) => fs.readFileSync(path.join(obs, p), 'utf8');

type Rule = { alert?: string; record?: string; expr: string; for?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
const groups = [...(parse(read('prometheus/rules/allingo-alerts.yml')) as { groups: Array<{ rules: Rule[] }> }).groups, ...(parse(read('prometheus/rules/allingo-recording.yml')) as { groups: Array<{ rules: Rule[] }> }).groups];
const rules = groups.flatMap((g) => g.rules);
const alerts = rules.filter((r) => r.alert);
const recorded = new Set(rules.filter((r) => r.record).map((r) => r.record!));

// Metrics của API/worker: nạp các module khai báo metrics để registry đủ tên
await import('../../src/shared/telemetry/instrumentation.js');
const own = new Set(metrics.names());
const EXTERNAL = /^(node_|pg_|redis_|probe_|process_cpu_seconds_total$|up$)/;
const FUNCS = new Set(['sum', 'rate', 'increase', 'max', 'min', 'avg', 'count', 'topk', 'bottomk', 'histogram_quantile', 'clamp_min', 'clamp_max', 'abs', 'absent', 'changes', 'label_values', 'time', 'vector', 'by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'bool', 'and', 'or', 'unless', 'offset', 'humanizePercentage', 'irate', 'delta', 'deriv', 'predict_linear']);

/** Tên metric trong một biểu thức PromQL (bỏ chuỗi, label matcher, mệnh đề by/without, khoảng thời gian, hàm) */
function metricNames(expr: string): string[] {
  const s = expr
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '');
  const out = new Set<string>();
  for (const m of s.matchAll(/[a-zA-Z_:][a-zA-Z0-9_:]*/g)) {
    const t = m[0];
    const next = s.slice((m.index ?? 0) + t.length).trimStart();
    if (FUNCS.has(t) || next.startsWith('(') || /^\d/.test(t)) continue;
    if (/^(e|inf|nan|le|d|h|m|s)$/i.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

function known(name: string): boolean {
  if (recorded.has(name) || EXTERNAL.test(name) || own.has(name)) return true;
  const base = name.replace(/_(bucket|sum|count)$/, '');
  return own.has(base);
}

const RUNBOOK_RE = /^https:\/\/github\.com\/phungduyhoc\/allingo\/blob\/main\/(docs\/runbooks\/[a-z0-9-]+\.md)(#[a-z0-9-]+)?$/;

describe('S11 – alert rules as code', () => {
  it('đủ alert bắt buộc (5xx, p95 lưu nháp, DLQ, webhook, AI fallback, chi phí AI, DB kết nối, disk, chứng chỉ, Redis)', () => {
    const names = new Set(alerts.map((a) => a.alert));
    for (const n of ['ApiHighErrorRate', 'DraftSaveLatencyHigh', 'DeadLetterJobs', 'PaymentWebhookFailures', 'AiFallbackRateHigh', 'AiCostPerHourHigh', 'DbConnectionsHigh', 'DiskUsageHigh', 'CertificateExpiringSoon', 'RedisDown', 'PartitionMissing']) expect(names.has(n), n).toBe(true);
  });

  it('mỗi alert: severity page|ticket, summary, description, runbook_url → tệp runbook tồn tại (và anchor có trong tệp)', () => {
    for (const a of alerts) {
      expect(['page', 'ticket'], a.alert).toContain(a.labels?.severity);
      expect(a.annotations?.summary, a.alert).toBeTruthy();
      expect(a.annotations?.description, a.alert).toBeTruthy();
      const m = RUNBOOK_RE.exec(a.annotations?.runbook_url ?? '');
      expect(m, `${a.alert} runbook_url`).not.toBeNull();
      const file = path.join(root, m![1]!);
      expect(fs.existsSync(file), `${a.alert} → ${m![1]}`).toBe(true);
      if (m![2]) expect(fs.readFileSync(file, 'utf8'), `${a.alert} anchor ${m![2]}`).toContain(`<a id="${m![2].slice(1)}"></a>`);
    }
  });

  it('ngưỡng đúng đặc tả S11 (5xx 1 %/5′, lưu nháp 500 ms/10′, webhook > 3/10′, fallback 20 %/15′, DB 80 %, disk 80 %, cert 14 ngày)', () => {
    const by = Object.fromEntries(alerts.map((a) => [a.alert!, a]));
    expect(by.ApiHighErrorRate!.expr).toContain('> 0.01');
    expect(by.ApiHighErrorRate!.for).toBe('5m');
    expect(by.DraftSaveLatencyHigh!.expr).toContain('> 0.5');
    expect(by.DraftSaveLatencyHigh!.for).toBe('10m');
    expect(by.PaymentWebhookFailures!.expr).toMatch(/\[10m\]\)\) > 3$/);
    expect(by.AiFallbackRateHigh!.expr).toContain('> 0.2');
    expect(by.AiFallbackRateHigh!.for).toBe('15m');
    expect(by.DbConnectionsHigh!.expr).toContain('> 0.8');
    expect(by.DiskUsageHigh!.expr).toContain('> 0.8');
    expect(by.CertificateExpiringSoon!.expr).toContain('14 * 86400');
    expect(by.RedisDown!.for).toBe('1m');
  });

  it('mọi metric trong alert/recording rule tồn tại', () => {
    for (const r of rules) for (const n of metricNames(r.expr)) expect(known(n), `${r.alert ?? r.record}: ${n}`).toBe(true);
  });
});

describe('S11 – dashboards as code', () => {
  const files = ['api-slo.json', 'exam.json', 'ai.json', 'billing.json', 'queues.json', 'infra.json'];
  it('6 dashboard JSON hợp lệ, uid duy nhất, panel có biểu thức + datasource Prometheus', () => {
    const uids = new Set<string>();
    for (const f of files) {
      const d = JSON.parse(read(`grafana/dashboards/${f}`)) as { uid: string; title: string; panels: Array<{ title: string; datasource: { uid: string }; targets: Array<{ expr: string }> }> };
      expect(d.uid, f).toMatch(/^allingo-/);
      expect(uids.has(d.uid)).toBe(false);
      uids.add(d.uid);
      expect(d.panels.length, f).toBeGreaterThanOrEqual(6);
      for (const p of d.panels) {
        expect(p.datasource.uid, `${f}: ${p.title}`).toBe('prometheus');
        expect(p.targets.length, `${f}: ${p.title}`).toBeGreaterThan(0);
        for (const t of p.targets) for (const n of metricNames(t.expr)) expect(known(n), `${f} / ${p.title}: ${n}`).toBe(true);
      }
    }
  });

  it('provisioning trỏ đúng thư mục dashboard + datasource uid dùng trong dashboard', () => {
    const prov = parse(read('grafana/provisioning/dashboards/dashboards.yml')) as { providers: Array<{ options: { path: string } }> };
    expect(prov.providers[0]!.options.path).toBe('/var/lib/grafana/dashboards');
    const ds = parse(read('grafana/provisioning/datasources/datasources.yml')) as { datasources: Array<{ uid: string }> };
    expect(ds.datasources.map((d) => d.uid).sort()).toEqual(['alertmanager', 'loki', 'prometheus', 'tempo']);
  });

  it('các tệp YAML của stack parse được; compose có đủ dịch vụ', () => {
    for (const f of ['compose.yml', 'prometheus/prometheus.yml', 'alertmanager/alertmanager.yml', 'loki/loki.yml', 'tempo/tempo.yml', 'otel-collector/config.yml', 'promtail/promtail.yml', 'blackbox/blackbox.yml', 'prometheus/tests/alerts.test.yml']) expect(() => parse(read(f)), f).not.toThrow();
    const compose = parse(read('compose.yml')) as { services: Record<string, unknown> };
    for (const s of ['prometheus', 'alertmanager', 'grafana', 'loki', 'tempo', 'otel-collector']) expect(Object.keys(compose.services)).toContain(s);
  });

  it('metricNames() bóc đúng tên', () => {
    expect(metricNames('histogram_quantile(0.95, sum by (le, route) (rate(http_server_request_duration_seconds_bucket{method="PUT"}[5m])))')).toEqual(['http_server_request_duration_seconds_bucket']);
    expect(metricNames('max(sum by (instance) (db_connections)) / max(db_max_connections) > bool 0')).toEqual(['db_connections', 'db_max_connections']);
  });
});
