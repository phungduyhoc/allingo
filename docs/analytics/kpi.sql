-- KPI beta kín (S12) – SQL tham chiếu cho docs/analytics/events.md §2. Bản chạy thật: apps/api/src/modules/analytics/beta-report.ts
-- (cùng logic, tham số hoá). Chạy trên replica: psql "$DATABASE_URL_REPLICA" -v start="'2026-11-01T17:00:00Z'" -v end="'2026-11-08T17:00:00Z'" -f docs/analytics/kpi.sql
-- Không PII: chỉ đếm/tỉ lệ.

\set ON_ERROR_STOP on
begin transaction read only;

-- Nhóm beta tester + mốc bắt đầu = max(đăng ký, đổi mã)
create temporary view cohort as
select u.id as user_id, greatest(u.created_at, coalesce(i.redeemed_at, u.created_at)) as start_at
from iam.users u
left join ops.beta_invites i on i.redeemed_by = u.id and i.status = 'redeemed'
where u.deleted_at is null and u.is_guest = false
  and (i.id is not null or exists (select 1 from iam.user_roles r where r.user_id = u.id and r.role_code = 'beta_tester'));

create temporary view activity as
select a.user_id, a.started_at as at from learn.attempts a join cohort c using (user_id)
union all
select sc.user_id, r.reviewed_at from learn.srs_reviews r join learn.srs_cards sc on sc.id = r.card_id join cohort c on c.user_id = sc.user_id
union all
select t.user_id, t.created_at from ai.ai_tasks t join cohort c on c.user_id = t.user_id where t.task_code in ('explain_mcq', 'tutor_chat');

-- 1) Activation: chẩn đoán xong ≤ 24 giờ
select count(*) as eligible,
       count(*) filter (where exists (select 1 from learn.attempts a where a.user_id = c.user_id and a.mode = 'diagnostic'
                                       and a.status = 'graded' and a.submitted_at <= c.start_at + interval '24 hours')) as activated
from cohort c where c.start_at <= :end::timestamptz - interval '24 hours';

-- 2) Giữ chân D1/D7/D14 (ngày lịch giờ VN)
with days as (
  select distinct a.user_id, ((a.at at time zone 'Asia/Ho_Chi_Minh')::date - (c.start_at at time zone 'Asia/Ho_Chi_Minh')::date) as d
  from activity a join cohort c using (user_id)
)
select n,
       count(*) filter (where c.start_at <= :end::timestamptz - (n + 1) * interval '1 day') as eligible,
       count(*) filter (where c.start_at <= :end::timestamptz - (n + 1) * interval '1 day'
                          and exists (select 1 from days x where x.user_id = c.user_id and x.d = n)) as retained
from cohort c cross join (values (1), (7), (14)) as v(n) group by n order by n;

-- 3) Phiên học trong tuần (khoảng nghỉ ≤ 30 phút)
with wk as (
  select user_id, at, case when lag(at) over w is null or at - lag(at) over w > interval '30 minutes' then 1 else 0 end as new_session
  from activity where at >= :start::timestamptz and at < :end::timestamptz
  window w as (partition by user_id order by at)
)
select count(distinct user_id) as active_testers, sum(new_session) as sessions from wk;

-- 4) Câu / người, giải thích / người
select (select count(*) from learn.attempt_answers aa join learn.attempts a on a.id = aa.attempt_id join cohort c on c.user_id = a.user_id
         where aa.created_at >= :start::timestamptz and aa.created_at < :end::timestamptz and aa.answer is not null) as questions,
       (select count(*) from ai.ai_tasks t join cohort c on c.user_id = t.user_id
         where t.task_code = 'explain_mcq' and t.created_at >= :start::timestamptz and t.created_at < :end::timestamptz) as explains,
       (select count(*) from cohort where start_at < :end::timestamptz) as testers;

-- 5) Tỉ lệ hữu ích (thumbs-up) + chi phí AI
select count(*) as feedback, count(*) filter (where f.rating = 'helpful') as thumbs_up
from ai.feedback f join cohort c on c.user_id = f.user_id where f.created_at >= :start::timestamptz and f.created_at < :end::timestamptz;
select coalesce(sum(t.cost_usd), 0) as cost_usd from ai.ai_tasks t join cohort c on c.user_id = t.user_id
where t.created_at >= :start::timestamptz and t.created_at < :end::timestamptz;

-- 6) NPS tích luỹ
select round(100.0 * (count(*) filter (where score >= 9) - count(*) filter (where score <= 6)) / nullif(count(*), 0), 1) as nps, count(*) as responses
from ops.survey_responses r join cohort c on c.user_id = r.user_id
where r.kind in ('nps_d7', 'nps_d14') and r.score is not null and r.created_at < :end::timestamptz;

-- 7) Ý định mua (thử checkout sandbox) + đơn đã thanh toán
select count(distinct o.user_id) as checkout_users, count(*) filter (where o.status = 'paid') as paid_orders
from billing.orders o join cohort c on c.user_id = o.user_id where o.created_at < :end::timestamptz;

-- 8) Hỗ trợ & SLA
select (select count(*) from ops.content_reports where status = 'open' and sla_due_at < now()) as content_reports_overdue,
       (select count(*) from ops.support_tickets where first_responded_at is null and first_response_due_at < now() and status in ('open', 'waiting_user')) as tickets_overdue,
       (select percentile_cont(0.5) within group (order by extract(epoch from first_responded_at - created_at) / 3600)
          from ops.support_tickets where first_responded_at is not null and created_at >= :start::timestamptz and created_at < :end::timestamptz) as median_first_response_hours;

rollback;
