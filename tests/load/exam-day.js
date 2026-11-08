/**
 * k6 – "Ngày thi" (Sprint 11): 5.000 VU / 30′ trên STAGING, ramp 10′.
 *   60 % làm đề Exam Mode (lưu nháp mỗi 10 s → nộp → làm đề mới)
 *   20 % xem lại bài đã chấm + giải thích AI (80 % trúng cache)
 *   10 % dashboard/thống kê (/me/stats, /me/attempts, /me/plan/today)
 *   10 % duyệt catalog/marketing (/programs, test-sets, vocab, flags, tra từ; MARKETING_URL nếu có)
 *
 * Staging (mặc định):  k6 run -e BASE=https://api-staging.allingo.vn/v1 -e TOKENS=tests/load/.out/tokens.json tests/load/exam-day.js
 * Máy phiên (thu nhỏ): k6 run -e BASE=http://localhost:4100/v1 -e VUS=200 -e RAMP=30s -e HOLD=60s tests/load/exam-day.js
 * Tham số: VUS (5000), RAMP (10m), HOLD (20m), SAVE_EVERY (10 s), SAVES_PER_ATTEMPT (35), CACHE_HIT (0.8),
 *          TOKENS (JSON mảng JWT – tests/load/seed-big.ts sinh; chỉ số chẵn = Pro), EXAM_SET (toeic-reading-full-01).
 * Ngưỡng nghiệm thu (S11): p95 PUT /answers < 200 ms, POST /submit < 800 ms, GET /review < 400 ms,
 *   explain (cache hit) < 500 ms, lỗi < 0,1 %. CPU DB < 70 % đo bằng dashboard "Hạ tầng" (không đo được từ k6).
 */
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = __ENV.BASE || 'http://localhost:4000/v1';
const VUS = Number(__ENV.VUS || 5000);
const RAMP = __ENV.RAMP || '10m';
const HOLD = __ENV.HOLD || '20m';
const SAVE_EVERY = Number(__ENV.SAVE_EVERY || 10);
const SAVES_PER_ATTEMPT = Number(__ENV.SAVES_PER_ATTEMPT || 35);
const CACHE_HIT = Number(__ENV.CACHE_HIT || 0.8);
const EXAM_SET = __ENV.EXAM_SET || 'toeic-reading-full-01';
const MARKETING_URL = __ENV.MARKETING_URL || '';

const tokens = new SharedArray('tokens', () => JSON.parse(open(__ENV.TOKENS || './.out/tokens.json')));

const putMs = new Trend('put_answers_ms', true);
const submitMs = new Trend('submit_ms', true);
const reviewMs = new Trend('review_ms', true);
const explainHitMs = new Trend('explain_cache_hit_ms', true);
const explainMissMs = new Trend('explain_miss_ms', true);
const readMs = new Trend('read_ms', true);
const flowErrors = new Rate('flow_errors');
const explainHits = new Counter('explain_cache_hits');
const explainMisses = new Counter('explain_cache_misses');

const share = (p) => Math.max(1, Math.round(VUS * p));
const stages = (n) => [
  { duration: RAMP, target: n },
  { duration: HOLD, target: n },
  { duration: '30s', target: 0 },
];

export const options = {
  scenarios: {
    exam: { executor: 'ramping-vus', exec: 'exam', startVUs: 0, stages: stages(share(0.6)), gracefulRampDown: '20s' },
    review: { executor: 'ramping-vus', exec: 'review', startVUs: 0, stages: stages(share(0.2)), gracefulRampDown: '20s' },
    dashboard: { executor: 'ramping-vus', exec: 'dashboard', startVUs: 0, stages: stages(share(0.1)), gracefulRampDown: '20s' },
    catalog: { executor: 'ramping-vus', exec: 'catalog', startVUs: 0, stages: stages(share(0.1)), gracefulRampDown: '20s' },
  },
  thresholds: {
    put_answers_ms: ['p(95)<200'],
    submit_ms: ['p(95)<800'],
    review_ms: ['p(95)<400'],
    explain_cache_hit_ms: ['p(95)<500'],
    read_ms: ['p(95)<300'],
    http_req_failed: ['rate<0.001'],
    flow_errors: ['rate<0.001'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  discardResponseBodies: false,
};

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Mỗi kịch bản dùng một dải token riêng (exam: Pro nửa đầu; review: Pro nửa sau; dashboard/catalog: Free) – không bị Exam Mode khoá */
function tokenFor(kind) {
  const n = tokens.length;
  const vu = exec.vu.idInTest;
  const half = Math.floor(n / 2);
  let idx;
  if (kind === 'exam') idx = ((vu * 2) % half) & ~1;
  else if (kind === 'review') idx = (half + ((vu * 2) % (n - half))) & ~1;
  // dashboard/catalog: chỉ số lẻ (Free) – không trùng người đang thi (Exam Mode khoá tra từ AI/giải thích)
  else idx = ((vu * 2) % n) | 1;
  return tokens[Math.min(idx, n - 1)];
}

const hdr = (token, extra = {}) => ({ headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile', Authorization: `Bearer ${token}`, ...extra } });
const ok = (res, codes = [200]) => {
  const good = codes.includes(res.status);
  flowErrors.add(!good);
  return good;
};

export function setup() {
  const t = tokens[0];
  const sets = http.get(`${BASE}/programs/toeic/test-sets?kind=full&limit=100`, hdr(t));
  if (sets.status !== 200) fail(`không đọc được test-sets: ${sets.status}`);
  const ts = sets.json('data').find((x) => x.code === EXAM_SET);
  if (!ts) fail(`không có đề ${EXAM_SET}`);
  // Câu để giải thích: lấy từ review một bài đã chấm của token review đầu tiên; làm nóng cache cho 80 % lượt
  const reviewer = tokens[Math.floor(tokens.length / 2) & ~1];
  const mine = http.get(`${BASE}/me/attempts?status=graded&limit=5`, hdr(reviewer));
  let explainPool = [];
  if (mine.status === 200 && mine.json('data').length) {
    const rv = http.get(`${BASE}/attempts/${mine.json('data')[0].id}/review`, hdr(reviewer));
    if (rv.status === 200) {
      explainPool = (rv.json('items') || [])
        .filter((it) => it.question && it.question.question_version_id && (it.question.question_type === 'mcq_single' || it.question.content?.options))
        .slice(0, 20)
        .map((it) => ({ qv: it.question.question_version_id, opt: 'A' }));
    }
  }
  for (const e of explainPool) http.post(`${BASE}/ai/explain`, JSON.stringify({ question_version_id: e.qv, chosen_option: e.opt }), hdr(reviewer, { Accept: 'application/json, text/event-stream' }));
  return { testSetId: ts.id, explainPool };
}

// ------------------------------------------------------------------ 60 %: làm đề
export function exam(data) {
  const token = tokenFor('exam');
  const t0 = Date.now();
  const a = http.post(`${BASE}/attempts`, JSON.stringify({ program: 'toeic', mode: 'exam', test_set_id: data.testSetId }), Object.assign(hdr(token, { 'Idempotency-Key': uuid() }), { tags: { name: 'POST /attempts' } }));
  if (!ok(a, [200, 201])) {
    sleep(SAVE_EVERY);
    return;
  }
  const attempt = a.json();
  const qs = attempt.questions || [];
  let q = 0;
  for (let i = 0; i < SAVES_PER_ATTEMPT && q < qs.length; i++) {
    sleep(SAVE_EVERY * (0.8 + Math.random() * 0.4));
    const batch = [];
    for (let k = 0; k < 1 + Math.floor(Math.random() * 3) && q < qs.length; k++, q++) batch.push({ question_id: qs[q].question_id, answer: { type: 'mcq_single', selected: 'ABCD'[Math.floor(Math.random() * 4)] }, time_spent_ms: 4000 + Math.floor(Math.random() * 20000) });
    const r = http.put(`${BASE}/attempts/${attempt.id}/answers`, JSON.stringify({ answers: batch, ui_state: { current_index: q } }), Object.assign(hdr(token), { tags: { name: 'PUT /attempts/{id}/answers' } }));
    putMs.add(r.timings.duration);
    ok(r, [200, 204]);
  }
  const s = http.post(`${BASE}/attempts/${attempt.id}/submit`, '{}', Object.assign(hdr(token), { tags: { name: 'POST /attempts/{id}/submit' } }));
  submitMs.add(s.timings.duration);
  ok(s, [200]);
  check(s, { 'submit graded': (r) => r.status === 200 });
  if (Date.now() - t0 < 1000) sleep(1);
}

// ------------------------------------------------------------------ 20 %: review + explain
export function review(data) {
  const token = tokenFor('review');
  const list = http.get(`${BASE}/me/attempts?status=graded&limit=5`, Object.assign(hdr(token), { tags: { name: 'GET /me/attempts' } }));
  readMs.add(list.timings.duration);
  if (!ok(list) || !list.json('data').length) {
    sleep(5);
    return;
  }
  const att = list.json('data')[Math.floor(Math.random() * list.json('data').length)];
  const rv = http.get(`${BASE}/attempts/${att.id}/review`, Object.assign(hdr(token), { tags: { name: 'GET /attempts/{id}/review' } }));
  reviewMs.add(rv.timings.duration);
  ok(rv);
  sleep(3 + Math.random() * 4);
  const pool = data.explainPool || [];
  if (pool.length) {
    const hit = Math.random() < CACHE_HIT;
    const e = hit ? pool[Math.floor(Math.random() * pool.length)] : { ...pool[Math.floor(Math.random() * pool.length)], opt: 'BCD'[Math.floor(Math.random() * 3)] };
    const r = http.post(`${BASE}/ai/explain`, JSON.stringify({ question_version_id: e.qv, chosen_option: e.opt }), Object.assign(hdr(token, { Accept: 'application/json, text/event-stream' }), { tags: { name: 'POST /ai/explain' } }));
    const cached = r.status === 200 && String(r.headers['Content-Type'] || '').includes('application/json');
    if (cached) {
      explainHits.add(1);
      explainHitMs.add(r.timings.duration);
    } else {
      explainMisses.add(1);
      explainMissMs.add(r.timings.duration);
    }
    ok(r, [200]);
  }
  sleep(5 + Math.random() * 5);
}

// ------------------------------------------------------------------ 10 %: dashboard/thống kê
export function dashboard() {
  const token = tokenFor('dashboard');
  for (const [name, path] of [
    ['GET /me/stats', '/me/stats?program=toeic'],
    ['GET /me/attempts', '/me/attempts?limit=10'],
    ['GET /me/plan/today', '/me/plan/today?program=toeic'],
  ]) {
    const r = http.get(`${BASE}${path}`, Object.assign(hdr(token), { tags: { name } }));
    readMs.add(r.timings.duration);
    ok(r, [200, 404]);
  }
  sleep(8 + Math.random() * 6);
}

// ------------------------------------------------------------------ 10 %: catalog/marketing
export function catalog() {
  const token = tokenFor('catalog');
  for (const [name, path] of [
    ['GET /programs', '/programs'],
    ['GET /programs/{p}/test-sets', '/programs/toeic/test-sets?limit=20'],
    ['GET /vocab/lists', '/vocab/lists?program=toeic'],
    ['GET /flags', '/flags'],
    ['GET /dictionary/lookup', `/dictionary/lookup?q=${['invoice', 'schedule', 'deadline', 'shipment', 'budget'][Math.floor(Math.random() * 5)]}`],
  ]) {
    const r = http.get(`${BASE}${path}`, Object.assign(hdr(token), { tags: { name } }));
    readMs.add(r.timings.duration);
    ok(r, [200]);
  }
  if (MARKETING_URL) http.get(MARKETING_URL, { tags: { name: 'GET marketing' } });
  sleep(6 + Math.random() * 6);
}
