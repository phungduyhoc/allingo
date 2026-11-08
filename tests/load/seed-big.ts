/**
 * Seed dữ liệu lớn cho load test (S11) bằng COPY FROM STDIN (postgres-js) vào DB RIÊNG (mặc định `allingo_load`, không đụng DB dev).
 *
 *   pnpm --filter @allingo/db exec tsx ../tests/load/seed-big.ts               # quy mô phiên: 2.000 user, 20.000 attempt, ~2 triệu answers
 *   SCALE=full pnpm --filter @allingo/db exec tsx ../tests/load/seed-big.ts    # quy mô staging: 20.000 / 200.000 / ~20 triệu
 *   USERS=… ATTEMPTS=… (ghi đè) · LOAD_DATABASE_URL=postgres://…/allingo_load · TOKENS_OUT=tests/load/.out/tokens.json
 *   TOKENS_ONLY=1 → chỉ ký lại JWT cho user load đã có (JWT hết hạn sau 4 giờ)
 *
 * Điều kiện: DB đã migrate + seed core,demo (catalog đề TOEIC). Script: tạo partition 6 tháng quá khứ cho attempt_answers,
 * xoá dữ liệu load cũ (email `load+N@load.allingo.test`), COPY users → enrollments → entitlements (50 % Pro) → attempts
 * (graded, 150 ngày) → attempt_answers (theo question_order thật của đề), ANALYZE; ghi JWT truy cập (HS256, AUTH_SECRET, 4 giờ)
 * cho k6/autocannon vào TOKENS_OUT (gitignored – KHÔNG commit). Dọn: `DROP DATABASE allingo_load` (docs/perf/report-S11.md).
 */
import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const req = createRequire(path.join(root, 'db/package.json'));
const { default: postgres } = (await import(pathToFileURL(req.resolve('postgres')).href)) as { default: typeof import('postgres').default };

const FULL = process.env.SCALE === 'full';
const USERS = Number(process.env.USERS ?? (FULL ? 20_000 : 2_000));
const ATTEMPTS = Number(process.env.ATTEMPTS ?? (FULL ? 200_000 : 20_000));
const URL_ = process.env.LOAD_DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo_load';
const TOKENS_OUT = process.env.TOKENS_OUT ?? path.join(root, 'tests/load/.out/tokens.json');
const TOKENS_N = Number(process.env.TOKENS ?? Math.min(USERS, 5_000));
const SECRET = process.env.AUTH_SECRET;
// Hash argon2id của mật khẩu chung 'Load@2026!' (m=19456,t=2,p=1) – cho luồng đăng nhập thật trong k6 (tuỳ chọn)
const PASSWORD_HASH = process.env.LOAD_PASSWORD_HASH ?? '';
const TEST_SETS = (process.env.TEST_SETS ?? 'toeic-reading-full-01,toeic-listening-full-01,toeic-lr-full-01,toeic-mini-lr-01,toeic-mini-lr-02').split(',');
const DAY = 86_400_000;

const sql = postgres(URL_, { max: 4, onnotice: () => undefined });
const t0 = Date.now();
const log = (m: string) => process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);

// PRNG xác định (mulberry32) – chạy lại cho cùng dữ liệu
let seed = 20261102;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
const iso = (ms: number) => new Date(ms).toISOString();

async function copy(table: string, columns: string[], rows: () => Generator<string>): Promise<void> {
  const stream = await sql.unsafe(`COPY ${table} (${columns.join(', ')}) FROM STDIN`).writable();
  await pipeline(Readable.from(rows(), { objectMode: false }), stream);
}

function b64url(b: Buffer | string) {
  return Buffer.from(b).toString('base64url');
}
function signJwt(sub: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ roles: ['learner'], guest: false, sid: randomUUID(), sub, iss: 'allingo', aud: 'allingo-api', iat: now, exp: now + 4 * 3600 }));
  const sig = createHmac('sha256', SECRET!).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function writeTokens(ids: string[]): void {
  if (!SECRET) {
    log('AUTH_SECRET trống → không sinh JWT');
    return;
  }
  fs.mkdirSync(path.dirname(TOKENS_OUT), { recursive: true });
  fs.writeFileSync(TOKENS_OUT, JSON.stringify(ids.slice(0, TOKENS_N).map((id) => signJwt(id))));
  log(`ghi ${Math.min(TOKENS_N, ids.length)} JWT (4 giờ) → ${path.relative(root, TOKENS_OUT)}`);
}

try {
  const [{ db }] = await sql`select current_database() as db`;
  if (db === 'allingo' || db === 'allingo_test') throw new Error(`Từ chối seed lớn vào DB ${db} – dùng DB riêng (allingo_load)`);
  // TOKENS_ONLY=1: chỉ ký lại JWT (hết hạn sau 4 giờ) cho user load sẵn có, theo thứ tự N của email load+N
  if (process.env.TOKENS_ONLY === '1') {
    const rows = await sql<{ id: string }[]>`select id from iam.users where email like 'load+%@load.allingo.test' order by split_part(split_part(email, '+', 2), '@', 1)::int`;
    writeTokens(rows.map((r) => r.id));
    await sql.end();
    process.exit(0);
  }
  log(`DB ${db}: users=${USERS} attempts=${ATTEMPTS}`);

  // 1) partition quá khứ (6 tháng) cho bảng lớn
  for (let i = -6; i <= 2; i++) {
    for (const [s, t] of [['learn', 'attempt_answers'], ['ai', 'ai_tasks'], ['ops', 'audit_logs'], ['ops', 'outbox']] as const) {
      await sql`select ops.ensure_month_partition(${s}, ${t}, (date_trunc('month', now()) + make_interval(months => ${i}))::date)`;
    }
  }

  // 2) đề + question_order thật (câu published theo thứ tự section → sort_order)
  const sets = await sql<{ id: string; code: string; time_limit_sec: number | null }[]>`select id, code, duration_sec as time_limit_sec from catalog.test_sets where code in ${sql(TEST_SETS)}`;
  if (!sets.length) throw new Error('Không thấy đề TOEIC – chạy db:migrate + db:seed --set core,demo vào DB load trước');
  const orders = new Map<string, Array<{ question_id: string; question_version_id: string; section_code: string; group_key: string | null; order_no: number }>>();
  for (const s of sets) {
    const items = await sql<{ question_id: string; question_version_id: string; section_code: string; group_key: string | null }[]>`
      select i.question_id, q.current_version_id as question_version_id, sec.code as section_code, i.group_key
      from catalog.test_set_items i join catalog.questions q on q.id = i.question_id join catalog.sections sec on sec.id = i.section_id
      where i.test_set_id = ${s.id} and q.current_version_id is not null order by sec.sort_order, i.sort_order`;
    orders.set(s.id, items.map((x, k) => ({ ...x, order_no: k + 1 })));
  }
  const setList = sets.filter((s) => (orders.get(s.id)?.length ?? 0) > 0);
  log(`đề: ${setList.map((s) => `${s.code}(${orders.get(s.id)!.length})`).join(', ')}`);

  // 3) xoá dữ liệu load cũ (CASCADE qua FK user)
  await sql`delete from billing.credit_balances where owner_type = 'user' and owner_id in (select id from iam.users where email like 'load+%@load.allingo.test')`;
  const del = await sql`delete from iam.users where email like 'load+%@load.allingo.test'`;
  log(`xoá ${del.count} user load cũ`);

  // 4) users
  const userIds = Array.from({ length: USERS }, () => randomUUID());
  const now = Date.now();
  await copy('iam.users', ['id', 'email', 'password_hash', 'display_name', 'ui_locale', 'explain_locale', 'status', 'is_guest', 'created_at', 'updated_at'], function* () {
    for (let i = 0; i < USERS; i++) yield `${userIds[i]}\tload+${i}@load.allingo.test\t${PASSWORD_HASH ? esc(PASSWORD_HASH) : '\\N'}\tLoad ${i}\tvi\tvi\tactive\tf\t${iso(now - 200 * DAY)}\t${iso(now - 200 * DAY)}\n`;
  });
  log('users xong');
  await copy('learn.enrollments', ['user_id', 'program_code', 'target_score', 'daily_minutes', 'is_active', 'started_at', 'updated_at'], function* () {
    for (let i = 0; i < USERS; i++) yield `${userIds[i]}\ttoeic\t${[600, 700, 800, 850][i % 4]}\t30\tt\t${iso(now - 190 * DAY)}\t${iso(now - 190 * DAY)}\n`;
  });
  // Pro = mọi tính năng của gói toeic_pro_monthly (FeatureGate kiểm theo feature_code, không theo nhãn "pro")
  const [plan] = await sql<{ features: Record<string, unknown> }[]>`select features from billing.plans where code = 'toeic_pro_monthly'`;
  const proFeatures = Object.entries(plan?.features ?? {}).filter(([, v]) => v === true).map(([k]) => k);
  await copy('billing.entitlements', ['user_id', 'program_code', 'feature_code', 'source', 'valid_from', 'valid_to'], function* () {
    for (let i = 0; i < USERS; i += 2) for (const f of proFeatures) yield `${userIds[i]}\t\\N\t${f}\tadmin\t${iso(now - 30 * DAY)}\t${iso(now + 60 * DAY)}\n`;
  });
  // credit đủ dùng cho explain/tutor sinh mới (cache miss) trong load test – ledger append-only + số dư (ADR-11)
  await copy('billing.credit_ledger', ['user_id', 'delta', 'balance_after', 'reason', 'ref_type', 'note', 'created_at'], function* () {
    for (let i = 0; i < USERS; i++) yield `${userIds[i]}\t100000\t100000\tadmin_adjust\tadmin\tload test seed\t${iso(now - 30 * DAY)}\n`;
  });
  await copy('billing.credit_balances', ['owner_type', 'owner_id', 'balance', 'updated_at'], function* () {
    for (let i = 0; i < USERS; i++) yield `user\t${userIds[i]}\t100000\t${iso(now - 30 * DAY)}\n`;
  });
  log('enrollments + entitlements (50 % Pro) + credit 100.000 xong');

  // 5) attempts (graded) – draft_state dùng chung theo đề (cùng question_order)
  const draftBySet = new Map(setList.map((s) => [s.id, esc(JSON.stringify({ question_order: orders.get(s.id), time_limit_sec: s.time_limit_sec, expires_at: null, section_elapsed_sec: {}, ui_state: {}, events: [], audio_plays: {}, answered_count: orders.get(s.id)!.length, last_saved_at: null }))]));
  const attempts: Array<{ id: string; set: string; started: number }> = [];
  await copy('learn.attempts', ['id', 'user_id', 'program_code', 'test_set_id', 'mode', 'status', 'started_at', 'submitted_at', 'time_spent_sec', 'raw_score', 'scaled_score', 'score_breakdown', 'draft_state'], function* () {
    for (let i = 0; i < ATTEMPTS; i++) {
      const s = setList[Math.floor(rnd() * setList.length)]!;
      const started = now - Math.floor(rnd() * 150 * DAY) - 3 * 3600_000;
      const n = orders.get(s.id)!.length;
      const raw = Math.floor(n * (0.35 + rnd() * 0.55));
      const scaled = Math.min(990, Math.round((raw / n) * 990 / 5) * 5);
      const id = randomUUID();
      attempts.push({ id, set: s.id, started });
      yield `${id}\t${userIds[i % USERS]}\ttoeic\t${s.id}\t${rnd() < 0.7 ? 'exam' : 'practice'}\tgraded\t${iso(started)}\t${iso(started + 3600_000)}\t3600\t${raw}\t${scaled}\t{"by_section":{}}\t${draftBySet.get(s.id)}\n`;
    }
  });
  log(`attempts ${ATTEMPTS} xong`);

  // 6) attempt_answers (khối lớn nhất) – câu theo question_order của đề, created_at trong khoảng làm bài
  let answers = 0;
  await copy('learn.attempt_answers', ['attempt_id', 'question_id', 'question_version_id', 'answer', 'is_correct', 'score', 'time_spent_ms', 'flagged', 'created_at'], function* () {
    for (const a of attempts) {
      const qs = orders.get(a.set)!;
      for (let k = 0; k < qs.length; k++) {
        const q = qs[k]!;
        const ok = rnd() < 0.62;
        answers++;
        yield `${a.id}\t${q.question_id}\t${q.question_version_id}\t{"type":"mcq_single","selected":"${'ABCD'[k % 4]}"}\t${ok ? 't' : 'f'}\t${ok ? 1 : 0}\t${1000 + Math.floor(rnd() * 60_000)}\tf\t${iso(a.started + k * 30_000)}\n`;
        if (answers % 500_000 === 0) log(`… ${answers} answers`);
      }
    }
  });
  log(`attempt_answers ${answers} xong`);
  await sql`analyze iam.users`;
  await sql`analyze learn.attempts`;
  await sql`analyze learn.attempt_answers`;
  await sql`analyze billing.entitlements`;
  await sql`analyze learn.enrollments`;
  log('ANALYZE xong');

  writeTokens(userIds);
  const [{ size }] = await sql`select pg_size_pretty(pg_database_size(current_database())) as size`;
  log(`kích thước DB: ${size}`);
} finally {
  await sql.end();
}
