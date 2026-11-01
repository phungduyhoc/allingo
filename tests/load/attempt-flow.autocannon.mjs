/**
 * Đo tải PUT /attempts/{id}/answers bằng autocannon (khi không có k6). Chuẩn bị N khách + attempt exam, rồi bắn
 * PUT luân phiên giữa các attempt trong DURATION giây với CONNECTIONS kết nối đồng thời.
 * Chạy: node tests/load/attempt-flow.autocannon.mjs  (env: BASE, USERS=200, CONNECTIONS=200, DURATION=60)
 */
import autocannon from 'autocannon';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:4000/v1';
const USERS = Number(process.env.USERS ?? 200);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 200);
const DURATION = Number(process.env.DURATION ?? 60);
const H = { 'content-type': 'application/json', 'x-client': 'mobile' };

async function prepare() {
  const g = await (await fetch(`${BASE}/auth/guest`, { method: 'POST', headers: H, body: '{}' })).json();
  const auth = { ...H, authorization: `Bearer ${g.access_token}` };
  const sets = await (await fetch(`${BASE}/programs/toeic/test-sets?kind=mini`, { headers: auth })).json();
  const ts = sets.data.find((t) => t.code === 'toeic-mini-part5-01');
  const a = await (await fetch(`${BASE}/attempts`, { method: 'POST', headers: { ...auth, 'idempotency-key': randomUUID() }, body: JSON.stringify({ program: 'toeic', mode: 'exam', test_set_id: ts.id }) })).json();
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
        const q = u.attempt.questions[n % u.attempt.questions.length];
        return { ...req, path: `/v1/attempts/${u.attempt.id}/answers`, headers: u.auth, body: JSON.stringify({ answers: [{ question_id: q.question_id, answer: { type: 'mcq_single', selected: 'ABCD'[n % 4] }, time_spent_ms: 2000 }] }) };
      },
    },
  ],
});
const lat = result.latency;
const errorsPct = ((result.errors + result.non2xx) / Math.max(1, result.requests.total)) * 100;
const summary = { connections: CONNECTIONS, duration_s: DURATION, requests: result.requests.total, rps_avg: result.requests.average, p50_ms: lat.p50, p90_ms: lat.p90, p97_5_ms: lat.p97_5, p99_ms: lat.p99, max_ms: lat.max, non2xx: result.non2xx, errors: result.errors, error_pct: Number(errorsPct.toFixed(3)) };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
