import { sql, type SQL } from 'drizzle-orm';

/**
 * Báo cáo beta tuần (S12) – dùng chung cho `pnpm report:beta` (script, kết nối replica trực tiếp) và GET /admin/reports/beta.
 * Định nghĩa KPI: docs/analytics/events.md §KPI; SQL tham chiếu: docs/analytics/kpi.sql. Không PII: chỉ đếm/tỉ lệ.
 * Nhóm (cohort) = beta tester = có vai trò `beta_tester` hoặc lời mời đã đổi; mốc bắt đầu = max(ngày đăng ký, ngày đổi mã).
 */
export interface Queryable {
  execute(query: SQL): Promise<unknown>;
}

export interface WeekRange {
  week: string;
  start: Date;
  end: Date;
}

export const GATE2_TARGETS = { activation: 0.6, d7: 0.35, nps: 30, thumbs_up: 0.8, crash_free: 0.995 } as const;

/** Tuần ISO (giờ VN): "2026-W45" → [thứ Hai 00:00 VN, thứ Hai kế tiếp); không truyền → tuần trước của `now` */
export function isoWeekRange(week: string | undefined, now: Date = new Date()): WeekRange {
  const VN = 7 * 3_600_000;
  let year: number;
  let wk: number;
  if (week) {
    const m = /^(\d{4})-W(\d{2})$/.exec(week);
    if (!m) throw new Error(`invalid ISO week ${week}`);
    year = Number(m[1]);
    wk = Number(m[2]);
  } else {
    const vn = new Date(now.getTime() + VN - 7 * 86_400_000);
    const r = isoWeekOf(vn);
    year = r.year;
    wk = r.week;
  }
  // Thứ Hai của tuần 1 = thứ Hai của tuần chứa ngày 4/1
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const mondayWeek1 = jan4 - dow * 86_400_000;
  const startUtcMidnight = mondayWeek1 + (wk - 1) * 7 * 86_400_000;
  const start = new Date(startUtcMidnight - VN);
  return { week: `${year}-W${String(wk).padStart(2, '0')}`, start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

export function isoWeekOf(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: t.getUTCFullYear(), week };
}

export interface BetaKpis {
  week: string;
  range: { start: string; end: string };
  simulated: boolean;
  cohort: { testers: number; new_this_week: number; invites_sent: number; invites_redeemed: number; waitlist: number };
  activation: { eligible: number; activated: number; rate: number | null };
  retention: { d1: RetentionCell; d7: RetentionCell; d14: RetentionCell };
  engagement: { active_testers: number; sessions: number; sessions_per_active_tester: number | null; sessions_per_tester: number | null; questions_per_tester: number | null; explains_per_tester: number | null };
  ai: { feedback: number; thumbs_up: number; thumbs_up_rate: number | null; cost_usd: number; cost_per_tester_usd: number | null; refused: number };
  nps: { responses: number; promoters: number; passives: number; detractors: number; score: number | null; by_kind: Record<string, { responses: number; score: number | null }> };
  conversion: { checkout_users: number; checkout_rate: number | null; paid_orders: number };
  support: { feedback: number; content_reports: number; content_reports_open: number; content_reports_overdue: number; tickets: number; tickets_open: number; tickets_overdue: number; median_first_response_hours: number | null };
  crash_free: { rate: number | null; source: string };
}

export interface RetentionCell {
  eligible: number;
  retained: number;
  rate: number | null;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : null);
const per = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

async function one<T>(db: Queryable, q: SQL): Promise<T> {
  const rows = (await db.execute(q)) as T[];
  return rows[0]!;
}

/** CTE nhóm beta tester: user_id, start_at (max(created_at, redeemed_at)) */
const COHORT = sql`
  cohort as (
    select u.id as user_id, greatest(u.created_at, coalesce(i.redeemed_at, u.created_at)) as start_at, u.email
    from iam.users u
    left join ops.beta_invites i on i.redeemed_by = u.id and i.status = 'redeemed'
    where u.deleted_at is null and u.is_guest = false
      and (i.id is not null or exists (select 1 from iam.user_roles r where r.user_id = u.id and r.role_code = 'beta_tester'))
  )`;

/** Sự kiện hoạt động (để tính giữ chân/phiên): bắt đầu bài, ôn thẻ, tác vụ AI do người học gọi */
const ACTIVITY = sql`
  activity as (
    select a.user_id, a.started_at as at from learn.attempts a join cohort c on c.user_id = a.user_id
    union all
    select sc.user_id, r.reviewed_at from learn.srs_reviews r join learn.srs_cards sc on sc.id = r.card_id join cohort c on c.user_id = sc.user_id
    union all
    select t.user_id, t.created_at from ai.ai_tasks t join cohort c on c.user_id = t.user_id where t.task_code in ('explain_mcq','tutor_chat')
  )`;

export async function computeBetaKpis(db: Queryable, range: WeekRange, opts: { asOf?: Date } = {}): Promise<BetaKpis> {
  const s = range.start.toISOString();
  const e = range.end.toISOString();
  const asOf = (opts.asOf ?? range.end).toISOString();
  const cohort = await one<{ testers: number; new_week: number; simulated: number; waitlist: number; sent: number; redeemed: number }>(
    db,
    sql`with ${COHORT} select
      (select count(*)::int from cohort where start_at < ${e}::timestamptz) as testers,
      (select count(*)::int from cohort where start_at >= ${s}::timestamptz and start_at < ${e}::timestamptz) as new_week,
      (select count(*)::int from cohort where email like '%@beta-demo.allingo.test') as simulated,
      (select count(*)::int from ops.waitlist_entries) as waitlist,
      (select count(*)::int from ops.beta_invites where sent_at < ${e}::timestamptz) as sent,
      (select count(*)::int from ops.beta_invites where status = 'redeemed' and redeemed_at < ${e}::timestamptz) as redeemed`,
  );
  // Activation: chẩn đoán xong (attempt diagnostic đã chấm) ≤ 24 giờ sau mốc bắt đầu; mẫu = tester có mốc ≥ 24 giờ trước asOf
  const act = await one<{ eligible: number; activated: number }>(
    db,
    sql`with ${COHORT} select count(*)::int as eligible,
      count(*) filter (where exists (select 1 from learn.attempts a where a.user_id = c.user_id and a.mode = 'diagnostic' and a.status = 'graded'
        and a.submitted_at <= c.start_at + interval '24 hours'))::int as activated
      from cohort c where c.start_at <= ${asOf}::timestamptz - interval '24 hours'`,
  );
  // Giữ chân Dn: có hoạt động trong ngày lịch thứ n (giờ VN) kể từ ngày bắt đầu; mẫu = tester đã qua hết ngày n
  const ret = await one<{ e1: number; r1: number; e7: number; r7: number; e14: number; r14: number }>(
    db,
    sql`with ${COHORT}, ${ACTIVITY},
      days as (select distinct a.user_id, ((a.at at time zone 'Asia/Ho_Chi_Minh')::date - (c.start_at at time zone 'Asia/Ho_Chi_Minh')::date) as d
               from activity a join cohort c on c.user_id = a.user_id)
      select
        count(*) filter (where c.start_at <= ${asOf}::timestamptz - interval '2 days')::int as e1,
        count(*) filter (where c.start_at <= ${asOf}::timestamptz - interval '2 days' and exists (select 1 from days x where x.user_id = c.user_id and x.d = 1))::int as r1,
        count(*) filter (where c.start_at <= ${asOf}::timestamptz - interval '8 days')::int as e7,
        count(*) filter (where c.start_at <= ${asOf}::timestamptz - interval '8 days' and exists (select 1 from days x where x.user_id = c.user_id and x.d = 7))::int as r7,
        count(*) filter (where c.start_at <= ${asOf}::timestamptz - interval '15 days')::int as e14,
        count(*) filter (where c.start_at <= ${asOf}::timestamptz - interval '15 days' and exists (select 1 from days x where x.user_id = c.user_id and x.d = 14))::int as r14
      from cohort c`,
  );
  // Phiên học: chuỗi hoạt động cách nhau ≤ 30 phút; trong tuần báo cáo
  const eng = await one<{ active: number; sessions: number; questions: number; explains: number }>(
    db,
    sql`with ${COHORT}, ${ACTIVITY},
      wk as (select user_id, at, case when lag(at) over (partition by user_id order by at) is null
                 or at - lag(at) over (partition by user_id order by at) > interval '30 minutes' then 1 else 0 end as new_session
             from activity where at >= ${s}::timestamptz and at < ${e}::timestamptz)
      select (select count(distinct user_id)::int from wk) as active, (select coalesce(sum(new_session), 0)::int from wk) as sessions,
        (select count(*)::int from learn.attempt_answers aa join learn.attempts a on a.id = aa.attempt_id join cohort c on c.user_id = a.user_id
           where aa.created_at >= ${s}::timestamptz and aa.created_at < ${e}::timestamptz and aa.answer is not null) as questions,
        (select count(*)::int from ai.ai_tasks t join cohort c on c.user_id = t.user_id
           where t.task_code = 'explain_mcq' and t.created_at >= ${s}::timestamptz and t.created_at < ${e}::timestamptz) as explains`,
  );
  const ai = await one<{ fb: number; up: number; cost: number; refused: number }>(
    db,
    sql`with ${COHORT} select
      (select count(*)::int from ai.feedback f join cohort c on c.user_id = f.user_id where f.created_at >= ${s}::timestamptz and f.created_at < ${e}::timestamptz) as fb,
      (select count(*)::int from ai.feedback f join cohort c on c.user_id = f.user_id where f.rating = 'helpful' and f.created_at >= ${s}::timestamptz and f.created_at < ${e}::timestamptz) as up,
      (select coalesce(sum(t.cost_usd), 0)::float8 from ai.ai_tasks t join cohort c on c.user_id = t.user_id where t.created_at >= ${s}::timestamptz and t.created_at < ${e}::timestamptz) as cost,
      (select count(*)::int from ai.ai_tasks t join cohort c on c.user_id = t.user_id where t.status = 'refused' and t.created_at >= ${s}::timestamptz and t.created_at < ${e}::timestamptz) as refused`,
  );
  // NPS: mọi câu trả lời tới hết tuần (tích luỹ) – NPS = %promoter (9–10) − %detractor (0–6)
  const npsRows = (await db.execute(sql`with ${COHORT} select r.kind, r.score from ops.survey_responses r join cohort c on c.user_id = r.user_id
      where r.kind in ('nps_d7','nps_d14') and r.score is not null and r.created_at < ${e}::timestamptz`)) as Array<{ kind: string; score: number }>;
  const conv = await one<{ checkout_users: number; paid: number }>(
    db,
    sql`with ${COHORT} select
      (select count(distinct o.user_id)::int from billing.orders o join cohort c on c.user_id = o.user_id where o.created_at < ${e}::timestamptz) as checkout_users,
      (select count(*)::int from billing.orders o join cohort c on c.user_id = o.user_id where o.status = 'paid' and o.created_at < ${e}::timestamptz) as paid`,
  );
  const sup = await one<{ fb: number; cr: number; cr_open: number; cr_overdue: number; t: number; t_open: number; t_overdue: number; median_h: number | null }>(
    db,
    sql`select
      (select count(*)::int from ops.feedback where created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz) as fb,
      (select count(*)::int from ops.content_reports where created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz) as cr,
      (select count(*)::int from ops.content_reports where status = 'open') as cr_open,
      (select count(*)::int from ops.content_reports where status = 'open' and sla_due_at < ${asOf}::timestamptz) as cr_overdue,
      (select count(*)::int from ops.support_tickets where created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz) as t,
      (select count(*)::int from ops.support_tickets where status in ('open','waiting_user')) as t_open,
      (select count(*)::int from ops.support_tickets where first_responded_at is null and first_response_due_at < ${asOf}::timestamptz and status in ('open','waiting_user')) as t_overdue,
      (select percentile_cont(0.5) within group (order by extract(epoch from first_responded_at - created_at) / 3600)::float8
         from ops.support_tickets where first_responded_at is not null and created_at >= ${s}::timestamptz and created_at < ${e}::timestamptz) as median_h`,
  );
  const nps = npsSummary(npsRows);
  const testers = cohort.testers;
  return {
    week: range.week,
    range: { start: s, end: e },
    simulated: cohort.simulated > 0,
    cohort: { testers, new_this_week: cohort.new_week, invites_sent: cohort.sent, invites_redeemed: cohort.redeemed, waitlist: cohort.waitlist },
    activation: { eligible: act.eligible, activated: act.activated, rate: ratio(act.activated, act.eligible) },
    retention: {
      d1: { eligible: ret.e1, retained: ret.r1, rate: ratio(ret.r1, ret.e1) },
      d7: { eligible: ret.e7, retained: ret.r7, rate: ratio(ret.r7, ret.e7) },
      d14: { eligible: ret.e14, retained: ret.r14, rate: ratio(ret.r14, ret.e14) },
    },
    engagement: { active_testers: eng.active, sessions: eng.sessions, sessions_per_active_tester: per(eng.sessions, eng.active), sessions_per_tester: per(eng.sessions, testers), questions_per_tester: per(eng.questions, testers), explains_per_tester: per(eng.explains, testers) },
    ai: { feedback: ai.fb, thumbs_up: ai.up, thumbs_up_rate: ratio(ai.up, ai.fb), cost_usd: Math.round(Number(ai.cost) * 10_000) / 10_000, cost_per_tester_usd: testers ? Math.round((Number(ai.cost) / testers) * 10_000) / 10_000 : null, refused: ai.refused },
    nps,
    conversion: { checkout_users: conv.checkout_users, checkout_rate: ratio(conv.checkout_users, testers), paid_orders: conv.paid },
    support: { feedback: sup.fb, content_reports: sup.cr, content_reports_open: sup.cr_open, content_reports_overdue: sup.cr_overdue, tickets: sup.t, tickets_open: sup.t_open, tickets_overdue: sup.t_overdue, median_first_response_hours: sup.median_h === null ? null : Math.round(Number(sup.median_h) * 10) / 10 },
    crash_free: { rate: null, source: 'chưa có (Sentry Release Health chưa cấu hình)' },
  };
}

export function npsSummary(rows: ReadonlyArray<{ kind: string; score: number }>): BetaKpis['nps'] {
  const calc = (xs: number[]) => {
    const p = xs.filter((x) => x >= 9).length;
    const d = xs.filter((x) => x <= 6).length;
    return { responses: xs.length, promoters: p, detractors: d, passives: xs.length - p - d, score: xs.length ? Math.round(((p - d) / xs.length) * 1000) / 10 : null };
  };
  const all = calc(rows.map((r) => r.score));
  const by: Record<string, { responses: number; score: number | null }> = {};
  for (const k of ['nps_d7', 'nps_d14']) {
    const c = calc(rows.filter((r) => r.kind === k).map((r) => r.score));
    by[k] = { responses: c.responses, score: c.score };
  }
  return { ...all, by_kind: by };
}

export interface PostHogSummary {
  events: Record<string, number>;
  web_vitals: { lcp_p75_ms: number | null; inp_p75_ms: number | null; cls_p75: number | null } | null;
}

export type PostHogFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** PostHog HogQL (POST /api/projects/{id}/query) – null khi chưa cấu hình hoặc lỗi (báo cáo ghi "chưa có") */
export async function fetchPostHogSummary(cfg: { host: string; projectId?: string; apiKey?: string }, range: WeekRange, fetcher: PostHogFetch = (u, i) => fetch(u, i)): Promise<PostHogSummary | null> {
  if (!cfg.projectId || !cfg.apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const q = `select event, count() from events where timestamp >= toDateTime('${range.start.toISOString().slice(0, 19).replace('T', ' ')}') and timestamp < toDateTime('${range.end.toISOString().slice(0, 19).replace('T', ' ')}') group by event order by count() desc limit 50`;
    const res = await fetcher(`${cfg.host.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(cfg.projectId)}/query/`, { method: 'POST', headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: { kind: 'HogQLQuery', query: q } }), signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: Array<[string, number]> };
    return { events: Object.fromEntries((body.results ?? []).map(([k, v]) => [k, Number(v)])), web_vitals: null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)} %`);
const num = (v: number | null) => (v === null ? '—' : String(v));
const status = (v: number | null, target: number) => (v === null ? 'chưa đủ dữ liệu' : v >= target ? 'ĐẠT' : 'CHƯA ĐẠT');

/** Markdown báo cáo tuần (tiếng Việt) */
export function renderBetaReport(k: BetaKpis, ph: PostHogSummary | null, generatedAt: Date = new Date()): string {
  const lines: string[] = [];
  lines.push(`# Báo cáo beta kín – tuần ${k.week}`, '');
  lines.push(`Khoảng: ${k.range.start} → ${k.range.end} (tuần ISO theo giờ VN) · sinh lúc ${generatedAt.toISOString()} bởi \`pnpm report:beta\` (DB replica${ph ? ' + PostHog' : ''}).`, '');
  if (k.simulated) lines.push('> **DỮ LIỆU GIẢ LẬP** – nhóm tester có tài khoản `@beta-demo.allingo.test` (seed `beta-demo`). Không dùng số này cho quyết định GATE-2.', '');
  lines.push('## 1. KPI so với mục tiêu GATE-2', '', '| KPI | Giá trị | Mẫu | Mục tiêu | Trạng thái |', '| --- | --- | --- | --- | --- |');
  lines.push(`| Activation (chẩn đoán xong ≤ 24 giờ) | ${pct(k.activation.rate)} | ${k.activation.activated}/${k.activation.eligible} | ≥ 60 % | ${status(k.activation.rate, GATE2_TARGETS.activation)} |`);
  lines.push(`| Giữ chân D1 | ${pct(k.retention.d1.rate)} | ${k.retention.d1.retained}/${k.retention.d1.eligible} | – | – |`);
  lines.push(`| Giữ chân D7 | ${pct(k.retention.d7.rate)} | ${k.retention.d7.retained}/${k.retention.d7.eligible} | ≥ 35 % | ${status(k.retention.d7.rate, GATE2_TARGETS.d7)} |`);
  lines.push(`| Giữ chân D14 | ${pct(k.retention.d14.rate)} | ${k.retention.d14.retained}/${k.retention.d14.eligible} | – | – |`);
  lines.push(`| NPS (ngày 7 + 14, tích luỹ) | ${num(k.nps.score)} | ${k.nps.responses} trả lời | ≥ 30 | ${status(k.nps.score, GATE2_TARGETS.nps)} |`);
  lines.push(`| Tỉ lệ hữu ích (thumbs-up) giải thích AI | ${pct(k.ai.thumbs_up_rate)} | ${k.ai.thumbs_up}/${k.ai.feedback} | ≥ 80 % | ${status(k.ai.thumbs_up_rate, GATE2_TARGETS.thumbs_up)} |`);
  lines.push(`| Crash-free sessions | ${pct(k.crash_free.rate)} | ${k.crash_free.source} | ≥ 99,5 % | ${status(k.crash_free.rate, GATE2_TARGETS.crash_free)} |`, '');
  lines.push('## 2. Nhóm tester & mời', '', `- Tester: **${k.cohort.testers}** (mới trong tuần: ${k.cohort.new_this_week}); danh sách chờ: ${k.cohort.waitlist}; lời mời đã gửi: ${k.cohort.invites_sent}, đã đổi: ${k.cohort.invites_redeemed} (${pct(k.cohort.invites_sent ? k.cohort.invites_redeemed / k.cohort.invites_sent : null)}).`, '');
  lines.push('## 3. Mức độ sử dụng (trong tuần)', '', `- Tester hoạt động: ${k.engagement.active_testers}/${k.cohort.testers}`, `- Phiên học (khoảng nghỉ ≤ 30 phút): ${k.engagement.sessions} · ${num(k.engagement.sessions_per_active_tester)} phiên/tester hoạt động · ${num(k.engagement.sessions_per_tester)} phiên/tester`, `- Số câu đã làm/tester: ${num(k.engagement.questions_per_tester)}`, `- Lượt giải thích AI/tester: ${num(k.engagement.explains_per_tester)}`, '');
  lines.push('## 4. AI', '', `- Phản hồi hữu ích/không: ${k.ai.feedback} (hữu ích ${k.ai.thumbs_up}) · tác vụ bị guardrail từ chối: ${k.ai.refused}`, `- Chi phí AI tuần: ${k.ai.cost_usd} USD · ${num(k.ai.cost_per_tester_usd)} USD/tester (×4,3 ≈ ${k.ai.cost_per_tester_usd === null ? '—' : (k.ai.cost_per_tester_usd * 4.3).toFixed(4)} USD/tester/tháng)`, '');
  lines.push('## 5. NPS', '', `- Promoter ${k.nps.promoters} · Passive ${k.nps.passives} · Detractor ${k.nps.detractors}`, `- Ngày 7: ${num(k.nps.by_kind.nps_d7?.score ?? null)} (${k.nps.by_kind.nps_d7?.responses ?? 0} trả lời) · Ngày 14: ${num(k.nps.by_kind.nps_d14?.score ?? null)} (${k.nps.by_kind.nps_d14?.responses ?? 0} trả lời)`, '');
  lines.push('## 6. Ý định mua (sandbox)', '', `- Tester đã thử checkout: ${k.conversion.checkout_users} (${pct(k.conversion.checkout_rate)}) · đơn đã thanh toán (sandbox/giả lập): ${k.conversion.paid_orders}`, '');
  lines.push('## 7. Phản hồi & hỗ trợ', '', `- Góp ý in-app tuần: ${k.support.feedback}`, `- Báo lỗi câu: ${k.support.content_reports} trong tuần · đang mở ${k.support.content_reports_open} · quá hạn 48 giờ ${k.support.content_reports_overdue}`, `- Ticket: ${k.support.tickets} trong tuần · đang mở ${k.support.tickets_open} · quá hạn phản hồi 24 giờ ${k.support.tickets_overdue} · trung vị phản hồi đầu ${num(k.support.median_first_response_hours)} giờ`, '');
  lines.push('## 8. PostHog', '');
  if (!ph) lines.push('chưa có (POSTHOG_PROJECT_ID / POSTHOG_PERSONAL_API_KEY chưa cấu hình hoặc không gọi được – số phễu client & Web Vitals bổ sung khi có key).', '');
  else {
    lines.push('| Sự kiện | Số lần |', '| --- | --- |');
    for (const [ev, n] of Object.entries(ph.events)) lines.push(`| ${ev} | ${n} |`);
    lines.push('');
  }
  lines.push('---', 'Định nghĩa KPI: docs/analytics/events.md · SQL: docs/analytics/kpi.sql. Số liệu không chứa PII.');
  return `${lines.join('\n')}\n`;
}
