/**
 * Đo tải PUT /attempts/{id}/answers bằng autocannon (khi không có k6). Chuẩn bị N khách + attempt exam, rồi bắn
 * PUT luân phiên giữa các attempt trong DURATION giây với CONNECTIONS kết nối đồng thời.
 * Chạy: node tests/load/attempt-flow.autocannon.mjs  (env: BASE, USERS=200, CONNECTIONS=200, DURATION=60)
 * Sprint 4 – luồng đề L&R 200 câu: TEST_SET_CODE=toeic-lr-full-01 KIND=full (đo thêm POST /attempts, GET /attempts/{id}/media);
 * BATCH=n câu mỗi PUT (mặc định 1); SUBMIT=1 → sau pha PUT nộp mọi attempt (song song 20) và đo thời gian chấm.
 */
import autocannon from 'autocannon';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:4000/v1';
const USERS = Number(process.env.USERS ?? 200);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 200);
const DURATION = Number(process.env.DURATION ?? 60);
const TEST_SET_CODE = process.env.TEST_SET_CODE ?? 'toeic-mini-part5-01';
const KIND = process.env.KIND ?? 'mini';
const BATCH = Number(process.env.BATCH ?? 1);
const SUBMIT = process.env.SUBMIT === '1';
const H = { 'content-type': 'application/json', 'x-client': 'mobile' };
const createMs = [];
const mediaMs = [];
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : null);

async function prepare() {
  const g = await (await fetch(`${BASE}/auth/guest`, { method: 'POST', headers: H, body: '{}' })).json();
  const auth = { ...H, authorization: `Bearer ${g.access_token}` };
  const sets = await (await fetch(`${BASE}/programs/toeic/test-sets?kind=${KIND}&limit=100`, { headers: auth })).json();
  const ts = sets.data.find((t) => t.code === TEST_SET_CODE);
  if (!ts) throw new Error(`không thấy đề ${TEST_SET_CODE} (kind=${KIND})`);
  let t = performance.now();
  const a = await (await fetch(`${BASE}/attempts`, { method: 'POST', headers: { ...auth, 'idempotency-key': randomUUID() }, body: JSON.stringify({ program: 'toeic', mode: 'exam', test_set_id: ts.id }) })).json();
  createMs.push(performance.now() - t);
  if (!a.questions) throw new Error(`tạo attempt lỗi: ${JSON.stringify(a).slice(0, 200)}`);
  t = performance.now();
  await (await fetch(`${BASE}/attempts/${a.id}/media`, { headers: auth })).json();
  mediaMs.push(performance.now() - t);
  return { auth, attempt: a };
}

const t0 = Date.now();
const users = [];
for (let i = 0; i < USERS; i += 20) users.push(...(await Promise.all(Array.from({ length: Math.min(20, USERS - i) }, prepare))));
process.stdout.write(`chuẩn bị ${users.length} khách + attempt trong ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

let n = 0;
const result = await autocannon({
  url: BASE,
  connections: CONNECTIONS,
  duration: DURATION,
  requests: [
    {
      method: 'PUT',
      setupRequest: (req) => {
        const u = users[n++ % users.length];
        const qs = u.attempt.questions;
        const answers = Array.from({ length: Math.min(BATCH, qs.length) }, (_, k) => ({ question_id: qs[(n + k) % qs.length].question_id, answer: { type: 'mcq_single', selected: 'ABCD'[(n + k) % 4] }, time_spent_ms: 2000 }));
        return { ...req, path: `/v1/attempts/${u.attempt.id}/answers`, headers: u.auth, body: JSON.stringify({ answers }) };
      },
    },
  ],
});
const lat = result.latency;
const errorsPct = ((result.errors + result.non2xx) / Math.max(1, result.requests.total)) * 100;
const summary = { test_set: TEST_SET_CODE, questions: users[0]?.attempt.questions.length, batch: BATCH, connections: CONNECTIONS, duration_s: DURATION, requests: result.requests.total, rps_avg: result.requests.average, p50_ms: lat.p50, p90_ms: lat.p90, p97_5_ms: lat.p97_5, p99_ms: lat.p99, max_ms: lat.max, non2xx: result.non2xx, errors: result.errors, error_pct: Number(errorsPct.toFixed(3)), create_attempt_ms: { p50: pct(createMs, 50), p95: pct(createMs, 95) }, attempt_media_ms: { p50: pct(mediaMs, 50), p95: pct(mediaMs, 95) } };
if (SUBMIT) {
  const submitMs = [];
  let failed = 0;
  for (let i = 0; i < users.length; i += 20) {
    await Promise.all(
      users.slice(i, i + 20).map(async (u) => {
        const t = performance.now();
        const r = await fetch(`${BASE}/attempts/${u.attempt.id}/submit`, { method: 'POST', headers: u.auth });
        submitMs.push(performance.now() - t);
        if (r.status !== 200) failed++;
        await r.arrayBuffer();
      }),
    );
  }
  summary.submit_ms = { n: submitMs.length, p50: pct(submitMs, 50), p95: pct(submitMs, 95), max: pct(submitMs, 100), failed };
}
for (const k of ['create_attempt_ms', 'attempt_media_ms', 'submit_ms']) if (summary[k]) for (const [kk, v] of Object.entries(summary[k])) if (typeof v === 'number') summary[k][kk] = Math.round(v);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
