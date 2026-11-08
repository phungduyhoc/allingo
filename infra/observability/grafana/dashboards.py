#!/usr/bin/env python3
"""Dashboards as code (S11): sinh 6 dashboard Grafana JSON vào grafana/dashboards/.

    python3 infra/observability/grafana/dashboards.py          # ghi lại JSON
    python3 infra/observability/grafana/dashboards.py --check  # CI: JSON trong repo phải trùng bản sinh

Chỉ dùng metrics do API/worker xuất (apps/api/src/shared/telemetry/metrics.ts) + exporter chuẩn (node, postgres, redis);
test apps/api/test/unit/s11-observability-config.test.ts đối chiếu tên metrics trong mọi biểu thức với registry.
"""
import json
import pathlib
import sys

OUT = pathlib.Path(__file__).parent / 'dashboards'
DS = {'type': 'prometheus', 'uid': 'prometheus'}
_pid = 0


def panel(title, exprs, kind='timeseries', unit='short', w=12, h=8, legend=None, thresholds=None, description=''):
    global _pid
    _pid += 1
    targets = []
    for i, e in enumerate(exprs if isinstance(exprs, list) else [exprs]):
        expr, leg = (e if isinstance(e, tuple) else (e, legend or ''))
        targets.append({'refId': chr(65 + i), 'datasource': DS, 'expr': expr, 'legendFormat': leg})
    p = {
        'id': _pid,
        'type': kind,
        'title': title,
        'description': description,
        'datasource': DS,
        'targets': targets,
        'gridPos': {'h': h, 'w': w, 'x': 0, 'y': 0},
        'fieldConfig': {'defaults': {'unit': unit}, 'overrides': []},
        'options': {},
    }
    if thresholds:
        p['fieldConfig']['defaults']['thresholds'] = {'mode': 'absolute', 'steps': [{'color': 'green', 'value': None}] + [{'color': c, 'value': v} for v, c in thresholds]}
    if kind == 'stat':
        p['options'] = {'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False}, 'colorMode': 'background', 'graphMode': 'area'}
    return p


def layout(panels):
    x = y = row_h = 0
    for p in panels:
        w, h = p['gridPos']['w'], p['gridPos']['h']
        if x + w > 24:
            x, y = 0, y + row_h
            row_h = 0
        p['gridPos'].update({'x': x, 'y': y})
        x += w
        row_h = max(row_h, h)
    return panels


def dashboard(uid, title, tags, panels, description):
    global _pid
    d = {
        'uid': uid,
        'title': title,
        'description': description,
        'tags': ['allingo', 's11'] + tags,
        'timezone': 'Asia/Ho_Chi_Minh',
        'schemaVersion': 39,
        'version': 1,
        'editable': False,
        'refresh': '30s',
        'time': {'from': 'now-6h', 'to': 'now'},
        'templating': {'list': [{'name': 'service', 'type': 'query', 'datasource': DS, 'query': 'label_values(http_server_requests_total, service)', 'includeAll': True, 'multi': True, 'current': {'text': 'All', 'value': '$__all'}}]},
        'annotations': {'list': [{'name': 'Deploy', 'datasource': DS, 'enable': True, 'expr': 'changes(process_start_time_seconds{service="allingo-api"}[2m]) > 0', 'iconColor': 'purple'}]},
        'links': [{'title': 'SLO & error budget', 'url': 'https://github.com/phungduyhoc/allingo/blob/main/docs/slo.md', 'type': 'link'}],
        'panels': layout(panels),
    }
    _pid = 0
    return d


S = 'service=~"$service"'
EXCL = 'route!~"/v1/(health|metrics).*"'

api_slo = dashboard('allingo-api-slo', 'Allingo – API SLO', ['slo'], [
    panel('Availability 30 ngày (SLO 99,9 %)', f'1 - (sum(increase(http_server_requests_total{{status=~"5..",{EXCL}}}[30d])) / clamp_min(sum(increase(http_server_requests_total{{{EXCL}}}[30d])), 1))', 'stat', 'percentunit', 6, 5, thresholds=[(0.999, 'green')]),
    panel('Error budget còn lại (tháng)', f'1 - ((sum(increase(http_server_requests_total{{status=~"5..",{EXCL}}}[30d])) / clamp_min(sum(increase(http_server_requests_total{{{EXCL}}}[30d])), 1)) / 0.001)', 'stat', 'percentunit', 6, 5, thresholds=[(0, 'red'), (0.25, 'orange'), (0.5, 'green')]),
    panel('Burn rate 1 giờ (×SLO)', 'max(allingo:http_error_ratio:rate1h) / 0.001', 'stat', 'short', 6, 5, thresholds=[(6, 'orange'), (14.4, 'red')]),
    panel('Request/giây', f'sum(rate(http_server_requests_total{{{S},{EXCL}}}[5m]))', 'stat', 'reqps', 6, 5),
    panel('Tỉ lệ 5xx theo route', f'topk(10, sum by (route) (rate(http_server_requests_total{{status=~"5..",{S}}}[5m])) / clamp_min(sum by (route) (rate(http_server_requests_total{{{S}}}[5m])), 1e-9))', unit='percentunit', w=12, legend='{{route}}'),
    panel('p95 theo nhóm endpoint (mục tiêu đọc 300 ms, lưu nháp 200 ms)', [
        (f'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{{method="GET",{S},{EXCL}}}[5m])))', 'đọc (GET)'),
        (f'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{{method="PUT",route="/v1/attempts/:attemptId/answers",{S}}}[5m])))', 'lưu nháp'),
        (f'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{{method="POST",route="/v1/attempts/:attemptId/submit",{S}}}[5m])))', 'nộp bài'),
        (f'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{{method="POST",route="/v1/ai/explain",{S}}}[5m])))', 'explain'),
    ], unit='s', w=12, thresholds=[(0.2, 'orange'), (0.3, 'red')]),
    panel('p95 top 10 route chậm', f'topk(10, histogram_quantile(0.95, sum by (le, method, route) (rate(http_server_request_duration_seconds_bucket{{{S},{EXCL}}}[5m]))))', unit='s', w=12, legend='{{method}} {{route}}'),
    panel('Giới hạn tốc độ (429) theo bucket', 'sum by (bucket) (rate(http_rate_limited_total[5m]))', unit='reqps', w=12, legend='{{bucket}}'),
    panel('Event loop p99 / request đang xử lý', [('max by (instance) (nodejs_eventloop_lag_p99_seconds)', 'lag p99 {{instance}}'), ('sum(http_server_requests_in_flight)', 'in-flight')], unit='s', w=12),
    panel('Lỗi gửi Sentry theo nguồn', 'sum by (source) (rate(errors_reported_total[5m]))', unit='short', w=12, legend='{{source}}'),
], 'Availability, p95 theo nhóm endpoint, error budget (docs/slo.md).')

exam = dashboard('allingo-exam', 'Allingo – Thi (Exam Mode)', ['exam'], [
    panel('Attempt tạo/giờ', 'sum(increase(http_server_requests_total{method="POST",route="/v1/attempts",status=~"20."}[1h]))', 'stat', 'short', 6, 5),
    panel('Nộp bài/giờ', 'sum(increase(http_server_requests_total{method="POST",route="/v1/attempts/:attemptId/submit",status="200"}[1h]))', 'stat', 'short', 6, 5),
    panel('p95 lưu nháp (SLO 200 ms)', 'allingo:draft_save_latency_p95:10m', 'stat', 's', 6, 5, thresholds=[(0.2, 'orange'), (0.5, 'red')]),
    panel('Nộp bài lỗi (5xx)/giờ', 'sum(increase(http_server_requests_total{method="POST",route="/v1/attempts/:attemptId/submit",status=~"5.."}[1h]))', 'stat', 'short', 6, 5, thresholds=[(1, 'red')]),
    panel('Lưu nháp – request/giây & p50/p95/p99', [
        ('sum(rate(http_server_requests_total{method="PUT",route="/v1/attempts/:attemptId/answers"}[5m]))', 'req/s'),
    ], unit='reqps', w=12),
    panel('Lưu nháp – phân vị độ trễ', [
        (f'histogram_quantile({q}, sum by (le) (rate(http_server_request_duration_seconds_bucket{{method="PUT",route="/v1/attempts/:attemptId/answers"}}[5m])))', f'p{int(q * 100)}') for q in (0.5, 0.95, 0.99)
    ], unit='s', w=12),
    panel('Nộp bài / Review – p95', [
        ('allingo:submit_latency_p95:10m', 'submit'),
        ('histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{method="GET",route="/v1/attempts/:attemptId/review"}[5m])))', 'review'),
    ], unit='s', w=12, thresholds=[(0.4, 'orange'), (0.8, 'red')]),
    panel('Truy vấn learn.attempt_answers – p95 & chậm', [
        ('histogram_quantile(0.95, sum by (le, op) (rate(db_query_duration_seconds_bucket{table="learn.attempt_answers"}[5m])))', 'p95 {{op}}'),
        ('sum(rate(db_slow_queries_total{table=~"learn.attempt.*"}[5m]))', 'slow/s'),
    ], unit='s', w=12),
    panel('Partition còn trước (tháng)', 'min by (table) (db_partition_months_ahead)', 'stat', 'short', 12, 5, legend='{{table}}', thresholds=[(0, 'red'), (1, 'orange'), (2, 'green')]),
    panel('Cache câu hỏi theo phiên bản (hit ratio)', 'sum(rate(cache_requests_total{cache="question_version",result="hit"}[5m])) / clamp_min(sum(rate(cache_requests_total{cache="question_version"}[5m])), 1e-9)', 'stat', 'percentunit', 12, 5),
], 'Attempt/giờ, lưu nháp p95, nộp bài lỗi, partition.')

ai = dashboard('allingo-ai', 'Allingo – AI', ['ai'], [
    panel('Chi phí AI 1 giờ (USD)', 'allingo:ai_cost_usd:1h', 'stat', 'currencyUSD', 6, 5, thresholds=[(3, 'orange'), (5, 'red')]),
    panel('Fallback rate 15′', 'allingo:ai_fallback_ratio:15m', 'stat', 'percentunit', 6, 5, thresholds=[(0.1, 'orange'), (0.2, 'red')]),
    panel('Explain cache hit ratio', 'sum(rate(ai_task_cache_hits_total{task="explain_mcq"}[15m])) / clamp_min(sum(rate(ai_task_duration_seconds_count{task="explain_mcq"}[15m])), 1e-9)', 'stat', 'percentunit', 6, 5),
    panel('Breaker mở', 'max by (provider) (ai_provider_circuit_state)', 'stat', 'short', 6, 5, legend='{{provider}}', thresholds=[(1, 'orange'), (2, 'red')]),
    panel('Chi phí/giờ theo task × model', 'sum by (task, model) (increase(ai_task_cost_usd_total[1h]))', unit='currencyUSD', w=12, legend='{{task}} · {{model}}'),
    panel('p95 theo task', 'histogram_quantile(0.95, sum by (le, task) (rate(ai_task_duration_seconds_bucket{model!="cache"}[10m])))', unit='s', w=12, legend='{{task}}'),
    panel('Token vào/ra theo task', 'sum by (task, direction) (rate(ai_task_tokens_total[10m]))', unit='short', w=12, legend='{{task}} {{direction}}'),
    panel('Thất bại / fallback / retry', [('sum by (task) (rate(ai_task_failures_total[10m]))', 'fail {{task}}'), ('sum by (task) (rate(ai_task_fallbacks_total[10m]))', 'fallback {{task}}'), ('sum by (provider) (rate(ai_provider_retries_total[10m]))', 'retry {{provider}}')], unit='short', w=12),
    panel('Explain trong Review (cache) – hit/miss', 'sum by (result) (rate(cache_requests_total{cache=~"explain|explain_review"}[5m]))', unit='reqps', w=12, legend='{{result}}'),
    panel('Kill-switch AI (đánh giá cờ)', 'sum by (key, result) (rate(feature_flag_evaluations_total{key=~"ff.ai.*"}[5m]))', unit='reqps', w=12, legend='{{key}} {{result}}'),
], 'Chi phí/giờ, fallback, p95 theo task, cache, kill-switch (ADR-0026).')

billing = dashboard('allingo-billing', 'Allingo – Billing', ['billing'], [
    panel('Đơn hàng/giờ', 'sum(increase(billing_orders_total[1h]))', 'stat', 'short', 6, 5),
    panel('Webhook thất bại 10′', 'sum(increase(billing_webhooks_total{result=~"invalid_signature|invalid_payload|error|amount_mismatch"}[10m]))', 'stat', 'short', 6, 5, thresholds=[(1, 'orange'), (4, 'red')]),
    panel('Lệch đối soát 24 giờ', 'sum(increase(billing_reconcile_mismatches_total[24h]))', 'stat', 'short', 6, 5, thresholds=[(1, 'red')]),
    panel('Checkout bật?', 'max(feature_flag_evaluations_total{key="ff.billing.checkout",result="on"}) > bool 0', 'stat', 'short', 6, 5),
    panel('Webhook theo cổng × kết quả', 'sum by (provider, result) (rate(billing_webhooks_total[5m]))', unit='reqps', w=12, legend='{{provider}} {{result}}'),
    panel('Gọi API cổng/hoá đơn – p95', 'histogram_quantile(0.95, sum by (le, provider, op) (rate(billing_provider_call_duration_seconds_bucket[10m])))', unit='s', w=12, legend='{{provider}} {{op}}'),
    panel('POST /orders & /pay – mã trạng thái', 'sum by (route, status) (rate(http_server_requests_total{route=~"/v1/orders.*"}[5m]))', unit='reqps', w=12, legend='{{route}} {{status}}'),
    panel('Dead-letter hoá đơn/thanh toán', 'max by (queue) (bullmq_deadletter_jobs{queue=~"maintenance|notify"})', unit='short', w=12, legend='{{queue}}'),
], 'Đơn/giờ, webhook thất bại, lệch đối soát, cổng thanh toán.')

queues = dashboard('allingo-queues', 'Allingo – Hàng đợi', ['queues'], [
    panel('Dead-letter 24 giờ', 'sum(max by (queue) (bullmq_deadletter_jobs))', 'stat', 'short', 6, 5, thresholds=[(1, 'red')]),
    panel('Job chờ (tổng)', 'sum(max by (queue) (bullmq_queue_jobs{state=~"waiting|prioritized"}))', 'stat', 'short', 6, 5, thresholds=[(200, 'orange'), (500, 'red')]),
    panel('Job chờ lâu nhất (giây)', 'max(bullmq_queue_oldest_waiting_seconds)', 'stat', 's', 6, 5, thresholds=[(120, 'orange'), (600, 'red')]),
    panel('Backpressure (worker tạm dừng)', 'max by (queue) (bullmq_worker_paused)', 'stat', 'short', 6, 5, legend='{{queue}}', thresholds=[(1, 'orange')]),
    panel('Độ sâu theo hàng đợi × trạng thái', 'max by (queue, state) (bullmq_queue_jobs)', unit='short', w=12, legend='{{queue}} {{state}}'),
    panel('Thời gian chờ p95 theo hàng đợi', 'histogram_quantile(0.95, sum by (le, queue) (rate(bullmq_job_wait_seconds_bucket[10m])))', unit='s', w=12, legend='{{queue}}'),
    panel('Thời gian xử lý p95 theo job', 'histogram_quantile(0.95, sum by (le, job) (rate(bullmq_job_duration_seconds_bucket[10m])))', unit='s', w=12, legend='{{job}}'),
    panel('Thất bại / hoãn theo job', [('sum by (job) (rate(bullmq_jobs_failed_total[10m]))', 'fail {{job}}'), ('sum by (job) (rate(bullmq_jobs_deferred_total[10m]))', 'defer {{job}}')], unit='short', w=12),
], 'BullMQ: độ sâu, chờ, xử lý, thất bại, DLQ, backpressure.')

infra = dashboard('allingo-infra', 'Allingo – Hạ tầng', ['infra'], [
    panel('CPU host', '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))', 'stat', 'percentunit', 6, 5, thresholds=[(0.7, 'orange'), (0.85, 'red')]),
    panel('RAM host', '1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)', 'stat', 'percentunit', 6, 5, thresholds=[(0.8, 'orange'), (0.9, 'red')]),
    panel('Kết nối DB / max', 'allingo:db_connection_ratio', 'stat', 'percentunit', 6, 5, thresholds=[(0.6, 'orange'), (0.8, 'red')]),
    panel('Disk cao nhất', 'max(1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})', 'stat', 'percentunit', 6, 5, thresholds=[(0.7, 'orange'), (0.8, 'red')]),
    panel('CPU PostgreSQL (process)', 'sum(rate(process_cpu_seconds_total{job="postgres"}[5m]))', unit='short', w=12, description='postgres-exporter; staging: Azure Monitor cpu_percent (Terraform alert)'),
    panel('Kết nối DB theo trạng thái', 'max by (state) (db_connections)', unit='short', w=12, legend='{{state}}'),
    panel('Truy vấn chậm/giây theo bảng (> 200 ms)', 'topk(10, sum by (table) (rate(db_slow_queries_total[5m])))', unit='short', w=12, legend='{{table}}'),
    panel('p95 truy vấn theo bảng', 'topk(10, histogram_quantile(0.95, sum by (le, table) (rate(db_query_duration_seconds_bucket[5m]))))', unit='s', w=12, legend='{{table}}'),
    panel('Redis: bộ nhớ & client', [('max(redis_memory_used_bytes)', 'memory'), ('max(redis_connected_clients)', 'clients')], unit='short', w=12),
    panel('RSS / heap API & worker', [('max by (service) (process_resident_memory_bytes)', 'rss {{service}}'), ('max by (service) (nodejs_heap_used_bytes)', 'heap {{service}}')], unit='bytes', w=12),
    panel('Kích thước DB', 'max(db_database_size_bytes)', 'stat', 'bytes', 12, 5),
    panel('Uptime check', 'probe_success{job="blackbox-http"}', 'stat', 'short', 12, 5, legend='{{instance}}', thresholds=[(1, 'green')]),
], 'CPU/RAM/disk, DB (kết nối, slow query), Redis, process, uptime.')

DASHBOARDS = {'api-slo.json': api_slo, 'exam.json': exam, 'ai.json': ai, 'billing.json': billing, 'queues.json': queues, 'infra.json': infra}

if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    drift = []
    for name, d in DASHBOARDS.items():
        text = json.dumps(d, ensure_ascii=False, indent=2) + '\n'
        path = OUT / name
        if '--check' in sys.argv:
            if not path.exists() or path.read_text(encoding='utf-8') != text:
                drift.append(name)
        else:
            path.write_text(text, encoding='utf-8')
    if drift:
        print('dashboards lệch bản sinh:', ', '.join(drift))
        sys.exit(1)
    print(f'{len(DASHBOARDS)} dashboards OK')
