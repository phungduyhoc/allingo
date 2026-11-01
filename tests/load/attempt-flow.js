/**
 * k6 – luồng làm bài (Sprint 3): khách → tạo attempt exam đề mini Part 5 → lưu nháp 10 lô → nộp.
 * Chạy: k6 run -e BASE=http://localhost:4000/v1 -e VUS=1000 -e DURATION=5m tests/load/attempt-flow.js
 * Ngưỡng nghiệm thu: p95 PUT /answers < 150 ms, lỗi < 0,1 %.
 * Lưu ý: rate limit API (RATE_LIMIT_MAX) có allowList 127.0.0.1 – chạy từ máy khác cần tăng RATE_LIMIT_MAX khi đo.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:4000/v1';
const putTrend = new Trend('put_answers_ms', true);
const errors = new Rate('flow_errors');

export const options = {
  scenarios: {
    exam: { executor: 'constant-vus', vus: Number(__ENV.VUS || 1000), duration: __ENV.DURATION || '5m' },
  },
  thresholds: {
    put_answers_ms: ['p(95)<150'],
    flow_errors: ['rate<0.001'],
    http_req_failed: ['rate<0.001'],
  },
};

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });

export default function () {
  const jsonHeaders = { 'Content-Type': 'application/json', 'X-Client': 'mobile' };
  const g = http.post(`${BASE}/auth/guest`, '{}', { headers: jsonHeaders });
  if (!check(g, { 'guest 201': (r) => r.status === 201 })) return errors.add(1);
  const auth = { ...jsonHeaders, Authorization: `Bearer ${g.json('access_token')}` };
  const sets = http.get(`${BASE}/programs/toeic/test-sets?kind=mini`, { headers: auth });
  const ts = (sets.json('data') || []).find((t) => t.code === 'toeic-mini-part5-01');
  if (!ts) return errors.add(1);
  const a = http.post(`${BASE}/attempts`, JSON.stringify({ program: 'toeic', mode: 'exam', test_set_id: ts.id }), { headers: { ...auth, 'Idempotency-Key': uuid() } });
  if (!check(a, { 'attempt 201': (r) => r.status === 201 })) return errors.add(1);
  const attempt = a.json();
  for (let round = 0; round < 10; round++) {
    const answers = attempt.questions.slice(0, round + 1).map((q) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: 'ABCD'[(round + q.order_no) % 4] }, time_spent_ms: 3000 }));
    const r = http.put(`${BASE}/attempts/${attempt.id}/answers`, JSON.stringify({ answers }), { headers: auth, tags: { name: 'PUT /attempts/{id}/answers' } });
    putTrend.add(r.timings.duration);
    errors.add(r.status !== 204);
    sleep(1 + Math.random());
  }
  const s = http.post(`${BASE}/attempts/${attempt.id}/submit`, '{}', { headers: auth });
  errors.add(!check(s, { 'submit 200': (r) => r.status === 200 }));
}
