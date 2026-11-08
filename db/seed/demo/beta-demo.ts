import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import argon2 from 'argon2';
import type { Db } from '../../src/client.js';
import { DEMO_PASSWORD } from './index.js';

/**
 * Seed `beta-demo` (S12) – DỮ LIỆU GIẢ LẬP để `pnpm report:beta` và trang admin có số để xem. KHÔNG chạy mặc định, KHÔNG chạy
 * trên production. ~50 beta tester `testerNN@beta-demo.allingo.test` (mật khẩu demo) + 80 người trong danh sách chờ, lời mời theo
 * đợt (≤ 50/ngày), hoạt động 14 ngày (chẩn đoán, luyện tập, giải thích AI + 👍/👎, khảo sát onboarding, NPS ngày 7/14, góp ý,
 * báo lỗi câu, ticket, thử checkout). Câu trả lời sinh theo mô hình IRT 2PL (năng lực tester × độ khó câu) để thống kê câu có ý
 * nghĩa; vài câu "phân biệt âm" có chủ đích để thấy đề xuất retire. Ngẫu nhiên xác định (mulberry32) → chạy lại cho số giống nhau
 * nếu cùng mốc thời gian. Idempotent: đã có tester01 → bỏ qua (xoá bằng `--reset`: xoá user @beta-demo.allingo.test trước).
 */
export const BETA_DEMO_DOMAIN = 'beta-demo.allingo.test';
export const BETA_DEMO_TESTERS = 50;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface BetaDemoResult {
  skipped?: 'exists';
  testers: number;
  waitlist: number;
  invites: number;
  attempts: number;
  answers: number;
  explains: number;
  surveys: number;
}

async function ensurePartitions(db: Db, from: Date, to: Date): Promise<void> {
  const months = new Set<string>();
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1); t <= to.getTime(); ) {
    const d = new Date(t);
    months.add(d.toISOString().slice(0, 10));
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  for (const m of months) for (const [s, tb] of [['learn', 'attempt_answers'], ['ai', 'ai_tasks'], ['ops', 'audit_logs'], ['ops', 'outbox']] as const) await db.execute(sql`select ops.ensure_month_partition(${s}, ${tb}, ${m}::date)`);
}

async function insertMany(db: Db, table: string, cols: string[], rows: unknown[][]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    if (!chunk.length) continue;
    const values = sql.join(chunk.map((r) => sql`(${sql.join(r.map((v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? sql`${JSON.stringify(v)}::jsonb` : sql`${v instanceof Date ? v.toISOString() : v}`)), sql`, `)})`), sql`, `);
    await db.execute(sql`insert into ${sql.raw(table)} (${sql.raw(cols.join(', '))}) values ${values} on conflict do nothing`);
  }
}

/** Toàn bộ seed trong MỘT transaction (lỗi giữa chừng → không để lại dữ liệu dở) */
export async function seedBetaDemo(db: Db, opts: { now?: Date; reset?: boolean } = {}): Promise<BetaDemoResult> {
  return db.transaction(async (tx) => seedInner(tx as unknown as Db, opts));
}

async function seedInner(db: Db, opts: { now?: Date; reset?: boolean }): Promise<BetaDemoResult> {
  const now = opts.now ?? new Date();
  if (opts.reset) {
    await db.execute(sql`delete from billing.credit_ledger where user_id in (select id from iam.users where email like ${`%@${BETA_DEMO_DOMAIN}`})`);
    await db.execute(sql`delete from billing.credit_balances where owner_type = 'user' and owner_id in (select id from iam.users where email like ${`%@${BETA_DEMO_DOMAIN}`})`);
    await db.execute(sql`delete from billing.orders where user_id in (select id from iam.users where email like ${`%@${BETA_DEMO_DOMAIN}`})`);
    await db.execute(sql`delete from ops.beta_invites where email like ${`%@${BETA_DEMO_DOMAIN}`}`);
    await db.execute(sql`delete from ops.waitlist_entries where email like ${`%@${BETA_DEMO_DOMAIN}`}`);
    await db.execute(sql`delete from ai.ai_tasks where user_id in (select id from iam.users where email like ${`%@${BETA_DEMO_DOMAIN}`})`);
    await db.execute(sql`delete from iam.users where email like ${`%@${BETA_DEMO_DOMAIN}`}`);
  }
  const [exists] = (await db.execute(sql`select 1 as x from iam.users where email = ${`tester01@${BETA_DEMO_DOMAIN}`}`)) as unknown as Array<{ x: number }>;
  if (exists) return { skipped: 'exists', testers: 0, waitlist: 0, invites: 0, attempts: 0, answers: 0, explains: 0, surveys: 0 };

  const rnd = mulberry32(20261108);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const start = new Date(now.getTime() - 15 * DAY);
  await ensurePartitions(db, start, now);

  const questions = (await db.execute(sql`
    select q.id, q.current_version_id as vid, s.code as section from catalog.questions q join catalog.sections s on s.id = q.section_id
    where q.status = 'published' and q.current_version_id is not null and q.program_code = 'toeic' order by q.id limit 400`)) as unknown as Array<{ id: string; vid: string; section: string }>;
  if (questions.length < 20) throw new Error('beta-demo cần ngân hàng câu demo (pnpm db:seed --set core,demo trước)');
  // Độ khó IRT theo câu (xác định); 3 % câu "phân biệt âm" (người giỏi lại sai nhiều – đáp án sai trong ngân hàng giả lập)
  const qParams = new Map(questions.map((q, i) => [q.id, { b: normal() * 0.9, a: i % 33 === 7 ? -0.8 : 0.8 + rnd() * 0.8 }]));
  const [planRow] = (await db.execute(sql`select p.id as plan_id, pr.id as price_id, pr.amount from billing.plans p join billing.prices pr on pr.plan_id = p.id where p.code = 'toeic_pro_monthly' limit 1`)) as unknown as Array<{ plan_id: string; price_id: string; amount: string }>;
  const [pv] = (await db.execute(sql`select v.id from ai.prompt_versions v join ai.prompt_templates t on t.id = v.template_id where t.code = 'explain_mcq' order by (v.status = 'active') desc, v.version_no desc limit 1`)) as unknown as Array<{ id: string }>;
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

  // ---------------------------------------------------------------- danh sách chờ + mời theo đợt
  const waitlist: unknown[][] = [];
  const invites: unknown[][] = [];
  const testers: Array<{ id: string; email: string; start: Date; theta: number; persona: 'engaged' | 'casual' | 'churn'; inviteId: string }> = [];
  for (let i = 1; i <= 80; i++) {
    const email = i <= BETA_DEMO_TESTERS ? `tester${String(i).padStart(2, '0')}@${BETA_DEMO_DOMAIN}` : `waitlist${String(i).padStart(2, '0')}@${BETA_DEMO_DOMAIN}`;
    const id = randomUUID();
    const joined = new Date(start.getTime() - (5 + rnd() * 20) * DAY);
    const invited = i <= 60;
    const redeemed = i <= BETA_DEMO_TESTERS;
    waitlist.push([id, email, 'toeic', i % 7 === 0 ? 'en' : 'vi', rnd() < 0.6, 'landing-toeic', redeemed ? 'joined' : invited ? 'invited' : 'waiting', joined, joined]);
    if (invited) {
      // Đợt 1 (ngày 1): 50 lời mời; đợt 2 (ngày 2): 10 lời mời – tôn trọng hạn mức 50/ngày
      const sentAt = new Date(start.getTime() + (i <= 50 ? 2 : 26) * HOUR + i * 60_000);
      const redeemAt = redeemed ? new Date(sentAt.getTime() + (i <= 50 ? Math.min(11.5 * DAY, Math.floor(rnd() * 3 + (i / 50) * 9) * DAY + rnd() * 10 * HOUR) : 0)) : null;
      const expired = !redeemed && i > 57;
      const userId = redeemed ? randomUUID() : null;
      const inviteId = randomUUID();
      invites.push([inviteId, email, id, 'toeic', 'vi', redeemed ? `seed-redeemed-${i}-${randomUUID()}` : `seed-sent-${i}-${randomUUID()}`, redeemed ? 'redeemed' : expired ? 'expired' : 'sent', i <= 50 ? 'beta-dot-1' : 'beta-dot-2', sentAt, new Date(sentAt.getTime() + 14 * DAY), 1, userId, redeemAt, redeemed ? { trial_ends_at: new Date(redeemAt!.getTime() + 60 * DAY).toISOString(), credits: 2000, simulated: true } : null, sentAt, sentAt]);
      if (redeemed) {
        const r = rnd();
        testers.push({ id: userId!, email, start: redeemAt!, theta: normal(), persona: r < 0.45 ? 'engaged' : r < 0.8 ? 'casual' : 'churn', inviteId });
      }
    }
  }
  // users trước (FK redeemed_by)
  await insertMany(db, 'iam.users', ['id', 'email', 'password_hash', 'display_name', 'ui_locale', 'explain_locale', 'status', 'is_guest', 'created_at', 'updated_at'], testers.map((t, i) => [t.id, t.email, passwordHash, `Tester ${String(i + 1).padStart(2, '0')} (giả lập)`, 'vi', 'vi', 'active', false, new Date(t.start.getTime() - 5 * 60_000), t.start]));
  await insertMany(db, 'iam.user_roles', ['user_id', 'role_code'], testers.flatMap((t) => [[t.id, 'learner'], [t.id, 'beta_tester']]));
  await insertMany(db, 'iam.consents', ['user_id', 'type', 'version'], testers.flatMap((t) => [[t.id, 'terms', '2026-11'], [t.id, 'privacy', '2026-11']]));
  await insertMany(db, 'learn.enrollments', ['user_id', 'program_code', 'target_score', 'daily_minutes', 'started_at'], testers.map((t) => [t.id, 'toeic', pick([550, 650, 750, 850]), pick([20, 30, 45, 60]), t.start]));
  await insertMany(db, 'ops.waitlist_entries', ['id', 'email', 'program', 'locale', 'consent_marketing', 'source', 'status', 'created_at', 'updated_at'], waitlist);
  await insertMany(db, 'ops.beta_invites', ['id', 'email', 'waitlist_entry_id', 'program', 'locale', 'code_hash', 'status', 'batch', 'sent_at', 'expires_at', 'send_attempts', 'redeemed_by', 'redeemed_at', 'grant_result', 'created_at', 'updated_at'], invites);
  // Quyền lợi beta: trial 60 ngày + 2.000 credit (ledger promo/beta_invite)
  if (planRow) {
    await insertMany(db, 'billing.subscriptions', ['user_id', 'plan_id', 'program_code', 'status', 'current_period_start', 'current_period_end', 'cancel_at_period_end'], testers.map((t) => [t.id, planRow.plan_id, 'toeic', 'trialing', t.start, new Date(t.start.getTime() + 60 * DAY), false]));
  }
  await insertMany(db, 'billing.credit_ledger', ['user_id', 'delta', 'balance_after', 'reason', 'ref_type', 'ref_id', 'note', 'expires_at', 'created_at'], testers.map((t) => [t.id, 2000, 2000, 'promo', 'beta_invite', t.inviteId, 'beta_tester (giả lập)', new Date(t.start.getTime() + 90 * DAY), t.start]));
  await insertMany(db, 'billing.credit_balances', ['owner_type', 'owner_id', 'balance'], testers.map((t) => ['user', t.id, 2000]));

  // ---------------------------------------------------------------- hoạt động
  const attempts: unknown[][] = [];
  const answers: unknown[][] = [];
  const tasks: unknown[][] = [];
  const feedback: unknown[][] = [];
  const pCorrect = (theta: number, qid: string) => {
    const p = qParams.get(qid)!;
    return 1 / (1 + Math.exp(-1.7 * p.a * (theta - p.b)));
  };
  const addAttempt = (t: (typeof testers)[number], at: Date, mode: 'diagnostic' | 'practice' | 'exam', n: number) => {
    const id = randomUUID();
    let correct = 0;
    const qs = Array.from({ length: n }, () => pick(questions));
    const seen = new Set<string>();
    let offset = 0;
    for (const q of qs) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      const ok = rnd() < pCorrect(t.theta, q.id);
      if (ok) correct++;
      const ms = Math.round(15_000 + rnd() * 50_000);
      offset += ms;
      answers.push([randomUUID(), id, q.id, q.vid, { type: 'mcq_single', selected: pick(['A', 'B', 'C', 'D']) }, ok, ok ? 1 : 0, ms, new Date(at.getTime() + offset)]);
    }
    const total = seen.size;
    const acc = total ? correct / total : 0;
    const scaled = mode === 'practice' ? null : Math.max(10, Math.min(990, Math.round((acc * 900 + 60) / 5) * 5));
    attempts.push([id, t.id, 'toeic', mode, 'graded', at, new Date(at.getTime() + offset + 30_000), Math.round(offset / 1000), correct, scaled, { by_section: {}, by_question_type: {}, by_subskill: {}, by_topic: {}, unanswered: 0, scale: {}, scaled: scaled !== null ? { total: scaled, listening: Math.round(scaled / 2 / 5) * 5, reading: Math.round(scaled / 2 / 5) * 5, estimated: true } : null }]);
    // Giải thích AI cho một phần câu sai + phản hồi 👍/👎 (≈ 82 % hữu ích)
    const wrong = total - correct;
    const explains = Math.min(wrong, Math.floor(rnd() * (t.persona === 'engaged' ? 4 : 2)));
    for (let k = 0; k < explains; k++) {
      const tid = randomUUID();
      const created = new Date(at.getTime() + offset + (k + 1) * 45_000);
      tasks.push([tid, t.id, 'explain_mcq', pv?.id ?? null, 'gemini-2.5-flash', 'google', 'succeeded', { question_version_id: pick(questions).vid }, 0.00085 + rnd() * 0.0006, 10, 900 + Math.round(rnd() * 900), created, created]);
      if (rnd() < 0.55) feedback.push([randomUUID(), t.id, tid, rnd() < 0.82 ? 'helpful' : pick(['not_helpful', 'wrong']), created]);
    }
  };
  for (const t of testers) {
    const r = rnd();
    const diagAt = r < 0.7 ? new Date(t.start.getTime() + (0.3 + rnd() * 12) * HOUR) : r < 0.82 ? new Date(t.start.getTime() + (30 + rnd() * 60) * HOUR) : null;
    if (diagAt && diagAt < now) addAttempt(t, diagAt, 'diagnostic', 40);
    const days = Math.floor((now.getTime() - t.start.getTime()) / DAY);
    const base = t.persona === 'engaged' ? 0.75 : t.persona === 'casual' ? 0.4 : 0.15;
    for (let d = 1; d <= days; d++) {
      const p = base * Math.exp(-d / (t.persona === 'churn' ? 3 : 14)) + (t.persona === 'engaged' ? 0.1 : 0.02);
      if (rnd() >= p) continue;
      const sessions = 1 + (rnd() < 0.35 ? 1 : 0);
      for (let s = 0; s < sessions; s++) {
        const at = new Date(t.start.getTime() + d * DAY + (8 + s * 6 + rnd() * 4) * HOUR);
        if (at >= now) continue;
        addAttempt(t, at, rnd() < 0.1 ? 'exam' : 'practice', 10 + Math.floor(rnd() * 20));
      }
    }
  }
  await insertMany(db, 'learn.attempts', ['id', 'user_id', 'program_code', 'mode', 'status', 'started_at', 'submitted_at', 'time_spent_sec', 'raw_score', 'scaled_score', 'score_breakdown'], attempts);
  await insertMany(db, 'learn.attempt_answers', ['id', 'attempt_id', 'question_id', 'question_version_id', 'answer', 'is_correct', 'score', 'time_spent_ms', 'created_at'], answers);
  await insertMany(db, 'ai.ai_tasks', ['id', 'user_id', 'task_code', 'prompt_version_id', 'model_used', 'provider', 'status', 'input_ref', 'cost_usd', 'credits_charged', 'latency_ms', 'created_at', 'finished_at'], tasks);
  await insertMany(db, 'ai.feedback', ['id', 'user_id', 'ai_task_id', 'rating', 'created_at'], feedback);

  // ---------------------------------------------------------------- khảo sát, NPS, góp ý, báo lỗi, ticket, checkout
  const surveys: unknown[][] = [];
  for (const t of testers) {
    const age = (now.getTime() - t.start.getTime()) / DAY;
    if (rnd() < 0.9) surveys.push([t.id, 'beta_onboarding', { goal: pick(['job', 'graduation', 'promotion', 'study_abroad']), exam_date: null, current_score: pick([null, 350, 450, 550, 650]), devices: [pick(['android', 'ios']), ...(rnd() < 0.5 ? ['laptop'] : [])], study_minutes_per_day: pick([15, 30, 45, 60]), simulated: true }, null, null, new Date(t.start.getTime() + 20 * 60_000)]);
    const npsScore = () => {
      const x = rnd();
      return t.persona === 'engaged' ? (x < 0.6 ? pick([9, 10]) : x < 0.9 ? pick([7, 8]) : pick([5, 6])) : t.persona === 'casual' ? (x < 0.35 ? pick([9, 10]) : x < 0.75 ? pick([7, 8]) : pick([3, 5, 6])) : x < 0.15 ? 9 : x < 0.45 ? 7 : pick([2, 4, 6]);
    };
    if (age >= 7 && rnd() < 0.7) surveys.push([t.id, 'nps_d7', {}, npsScore(), rnd() < 0.3 ? 'Giải thích dễ hiểu, muốn thêm đề Listening (giả lập)' : null, new Date(t.start.getTime() + (7 + rnd() * 2) * DAY)]);
    if (age >= 14 && rnd() < 0.6) surveys.push([t.id, 'nps_d14', {}, npsScore(), null, new Date(t.start.getTime() + 14 * DAY + rnd() * 6 * HOUR)]);
  }
  await insertMany(db, 'ops.survey_responses', ['user_id', 'kind', 'answers', 'score', 'comment', 'created_at'], surveys.filter((s) => (s[5] as Date) < now));
  const fbRows: unknown[][] = [];
  for (let i = 0; i < 25; i++) {
    const t = pick(testers);
    fbRows.push([t.id, pick(['bug', 'idea', 'ux', 'content_error', 'performance']), pick(['Nút nộp bài bị che trên điện thoại (giả lập)', 'Muốn có chế độ tối (giả lập)', 'Audio Part 3 hơi nhỏ (giả lập)', 'Trang kết quả tải chậm (giả lập)']), '/toeic/practice', { trace_id: randomUUID().replace(/-/g, ''), simulated: true }, pick(['new', 'triaged', 'done']), new Date(t.start.getTime() + rnd() * Math.max(1, now.getTime() - t.start.getTime()))]);
  }
  await insertMany(db, 'ops.feedback', ['user_id', 'kind', 'body', 'page', 'context', 'status', 'created_at'], fbRows);
  const reports: unknown[][] = [];
  const reported = new Set<string>();
  for (let i = 0; i < 14; i++) {
    const t = pick(testers);
    const q = questions[(i * 33 + 7) % questions.length]!;
    if (reported.has(`${t.id}:${q.vid}`)) continue;
    reported.add(`${t.id}:${q.vid}`);
    const created = new Date(now.getTime() - (0.5 + rnd() * 9) * DAY);
    const status = i < 2 ? 'open' : pick(['fixed', 'confirmed', 'rejected', 'fixed']);
    reports.push([t.id, 'question_version', q.vid, pick(['wrong_answer', 'typo', 'unclear']), 'Đáp án có vẻ sai (giả lập)', status, new Date(created.getTime() + 48 * HOUR), created, status === 'open' ? null : new Date(created.getTime() + rnd() * 40 * HOUR), created]);
  }
  await insertMany(db, 'ops.content_reports', ['user_id', 'entity_type', 'entity_id', 'reason', 'message', 'status', 'sla_due_at', 'created_at', 'resolved_at', 'updated_at'], reports);
  const tickets: unknown[][] = [];
  for (let i = 0; i < 8; i++) {
    const t = pick(testers);
    const created = new Date(now.getTime() - (0.2 + rnd() * 10) * DAY);
    const responded = i < 7 ? new Date(created.getTime() + (1 + rnd() * 20) * HOUR) : null;
    tickets.push([t.id, pick(['Không nghe được audio', 'Mất điểm khi mất mạng', 'Hỏi về gói Pro', 'Lỗi đăng nhập Google']) + ' (giả lập)', 'Mô tả sự cố (giả lập)', 'inapp', responded ? pick(['waiting_user', 'resolved']) : 'open', 'normal', pick(['technical', 'exam', 'billing', 'account']), { simulated: true }, new Date(created.getTime() + 24 * HOUR), responded && responded < now ? responded : null, created, created, created]);
  }
  await insertMany(db, 'ops.support_tickets', ['user_id', 'subject', 'body', 'channel', 'status', 'priority', 'category', 'context', 'first_response_due_at', 'first_responded_at', 'last_message_at', 'created_at', 'updated_at'], tickets);
  if (planRow) {
    const orders: unknown[][] = [];
    for (const t of testers.filter(() => rnd() < 0.2)) {
      const paid = rnd() < 0.35;
      const at = new Date(t.start.getTime() + (3 + rnd() * 8) * DAY);
      if (at >= now) continue;
      orders.push([t.id, planRow.plan_id, planRow.price_id, 'VND', planRow.amount, planRow.amount, paid ? 'paid' : pick(['cancelled', 'expired', 'pending']), `beta-demo-${randomUUID()}`, at, paid ? at : null]);
    }
    await insertMany(db, 'billing.orders', ['user_id', 'plan_id', 'price_id', 'currency', 'subtotal', 'total', 'status', 'idempotency_key', 'created_at', 'paid_at'], orders);
  }
  return { testers: testers.length, waitlist: waitlist.length, invites: invites.length, attempts: attempts.length, answers: answers.length, explains: tasks.length, surveys: surveys.length };
}
