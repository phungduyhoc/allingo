import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { ieltsRoundOverall, suggestTargetFor } from '@allingo/scoring';
import {
  addDays,
  daysBetween,
  examProgress,
  forecastStatus,
  generatePlan,
  isValidTimeZone,
  localDate,
  quickSuggestion,
  validatePlan,
  weekProgress,
  type MasteryRow,
  type Weekday,
} from '@allingo/planner';
import { DEFAULT_PROGRAM, DOMAIN_EVENTS, programDef, JOB_NAMES, XP_TABLE, type PlanCreateInput, type PlanSettings, type PlanTask, type PlanTaskPatch, type PlanToday, type ProgramCode, type StudyPlan } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../../shared/db/db.module.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { FeatureDisabled, Forbidden, NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { JobsService } from '../../../shared/queue/jobs.service.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { FeatureFlagService, FeatureGateService } from '../../billing/index.js';
import { CatalogQueryService } from '../../catalog/index.js';
import { EnrollmentsService, UsersService } from '../../iam/index.js';
import { AttemptsService } from '../../test-engine/index.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { ERROR_RESOLVED_EVENT, ErrorLogService, type ErrorResolvedEvent } from '../errors/error-log.service.js';
import { SRS_REVIEWED_EVENT, SrsService, type SrsReviewedEvent } from '../srs.service.js';
import { TASK_EXPIRE_AFTER_DAYS, taskDto, toInventory, toProgressTasks, weekDto, type PlanRow, type StoredStrategy, type TaskRow, type WeekRow } from './plan-mapper.js';

const { learnStudyPlans, learnPlanWeeks, learnPlanTasks, learnSkillMastery, learnPlanAdjustments } = schema;
type Tx = Parameters<Parameters<DbService['db']['transaction']>[0]>[0];

export const STUDY_PLAN_FLAG = 'ff.learning.study_plan';
const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';
/** Việc lộ trình tự đánh dấu "xong" được cộng XP + tính ngày học (không có bài làm kiểm chứng) */
const SELF_REPORTED_TYPES = new Set(['vocab_review', 'review_errors', 'lesson', 'grammar', 'dictation', 'shadowing']);
/** S10: task review_errors tự done khi đã hiểu ≥ 10 lỗi trong ngày hoặc không còn lỗi chưa hiểu */
const REVIEW_ERRORS_DONE_AT = 10;

interface GradedPayload {
  attempt_id: string;
  user_id: string;
  program?: string;
  mode?: string;
  test_set_id?: string | null;
  section_id?: string | null;
  plan_task_id?: string | null;
  scaled_score?: number | null;
  correct?: number;
  total?: number;
}

export interface PlanTree {
  plan: PlanRow;
  strategy: StoredStrategy;
  weeks: WeekRow[];
  tasks: TaskRow[];
  enrollment: { id: string; userId: string; programCode: string };
}

/**
 * Lộ trình học (Sprint 9 – ADR-0032): PlanGenerator thuần (@allingo/planner) + lưu study_plans/plan_weeks/plan_tasks, "Hôm nay
 * học gì", đánh dấu task, tự `done` khi `attempt.graded`/`lesson.completed` (outbox, idempotent), tự `expired` sau 3 ngày,
 * tiến độ & dự báo theo quy tắc. Cài đặt (phút/tuần, ngày học, giờ nhắc, múi giờ) nằm trong `strategy.settings` (A136).
 */
@Injectable()
export class PlanService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'learning.plan' });

  constructor(
    private readonly dbs: DbService,
    private readonly enrollments: EnrollmentsService,
    private readonly users: UsersService,
    private readonly catalog: CatalogQueryService,
    private readonly gate: FeatureGateService,
    private readonly flags: FeatureFlagService,
    private readonly attempts: AttemptsService,
    private readonly outbox: OutboxService,
    private readonly jobs: JobsService,
    private readonly realtime: RealtimeGateway,
    private readonly gamification: GamificationService,
    private readonly srs: SrsService,
    private readonly errorLog: ErrorLogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.jobs.register('grading', JOB_NAMES.PLAN_GENERATE, async (p) => ({ plan_id: await this.regenerateNow(String(p.user_id), String(p.program) as ProgramCode) }));
    this.jobs.register('maintenance', JOB_NAMES.PLAN_EXPIRE_TASKS, async () => this.expireDue());
  }

  // ------------------------------------------------------------------ ngữ cảnh
  private now(): Date {
    return new Date(this.clock.now());
  }

  async userCtx(userId: string): Promise<{ tz: string; locale: string; today: string }> {
    const u = await this.users.findById(userId);
    const tz = u?.timezone && isValidTimeZone(u.timezone) ? u.timezone : DEFAULT_TZ;
    return { tz, locale: u?.uiLocale ?? 'vi', today: localDate(this.clock.now(), tz) };
  }

  async currentTree(userId: string, program: string, db: DbOrTx = this.dbs.db): Promise<PlanTree | null> {
    const enrollment = await this.enrollments.get(userId, program as ProgramCode, db);
    if (!enrollment) return null;
    const [plan] = await db.select().from(learnStudyPlans).where(and(eq(learnStudyPlans.enrollmentId, enrollment.id), eq(learnStudyPlans.isCurrent, true))).orderBy(desc(learnStudyPlans.versionNo)).limit(1);
    if (!plan) return null;
    return this.treeOf(plan, { id: enrollment.id, userId: enrollment.userId, programCode: enrollment.programCode }, db);
  }

  async treeOf(plan: PlanRow, enrollment: PlanTree['enrollment'], db: DbOrTx = this.dbs.db): Promise<PlanTree> {
    const weeks = await db.select().from(learnPlanWeeks).where(eq(learnPlanWeeks.planId, plan.id)).orderBy(asc(learnPlanWeeks.weekNo));
    const tasks = weeks.length ? await db.select().from(learnPlanTasks).where(inArray(learnPlanTasks.planWeekId, weeks.map((w) => w.id))).orderBy(asc(learnPlanTasks.dueDate), asc(learnPlanTasks.id)) : [];
    return { plan, strategy: plan.strategy as StoredStrategy, weeks, tasks, enrollment };
  }

  /** Tuần chứa ngày `today` (trước khi bắt đầu → tuần 1; sau khi kết thúc → tuần cuối) */
  weekIndexOf(tree: PlanTree, today: string): number {
    const metas = tree.strategy.weeks_meta ?? [];
    const idx = tree.weeks.findIndex((w) => today >= w.startDate && today <= (metas.find((m) => m.week_no === w.weekNo)?.end_date ?? addDays(w.startDate, 6)));
    if (idx >= 0) return idx;
    return tree.weeks.length && today < tree.weeks[0]!.startDate ? 0 : Math.max(0, tree.weeks.length - 1);
  }

  // ------------------------------------------------------------------ tạo / sinh lại
  /** POST /me/plan – từ onboarding: cập nhật enrollment + múi giờ, sinh lộ trình mới (phiên bản +1) */
  async create(userId: string, input: PlanCreateInput): Promise<StudyPlan> {
    await this.assertEnabled(userId, input.program);
    await this.gate.check(userId, input.program, 'study_plan');
    const user = await this.users.findById(userId);
    const tz = input.timezone ?? user?.timezone ?? DEFAULT_TZ;
    if (!isValidTimeZone(tz)) throw new ValidationFailed({ issues: [{ path: 'timezone', message: 'invalid IANA time zone' }] });
    if (input.timezone && input.timezone !== user?.timezone) await this.users.update(userId, { timezone: input.timezone });
    const today = localDate(this.clock.now(), tz);
    if (input.exam_date && (input.exam_date <= today || daysBetween(today, input.exam_date) > 730)) throw new ValidationFailed({ issues: [{ path: 'exam_date', message: 'exam_date must be after today and within 2 years' }] });
    const days = [...new Set(input.study_days)] as Weekday[];
    await this.enrollments.upsert(userId, {
      program: input.program,
      ...(input.target_score !== undefined ? { target_score: input.target_score } : {}),
      ...(input.exam_date ? { exam_date: input.exam_date } : {}),
      daily_minutes: Math.max(10, Math.min(240, Math.round(input.weekly_minutes / days.length))),
    });
    const enrollment = await this.enrollments.get(userId, input.program);
    const settings: PlanSettings = {
      weekly_minutes: input.weekly_minutes,
      study_days: days,
      reminder_time: input.reminder_time ?? null,
      timezone: tz,
      start_date: today,
      exam_date: input.exam_date ?? enrollment?.examDate ?? null,
      target_score: input.target_score ?? (enrollment?.targetScore !== null && enrollment?.targetScore !== undefined ? Number(enrollment.targetScore) : null),
    };
    await this.generate(userId, input.program, settings, 'onboarding');
    return this.get(userId, input.program);
  }

  /** POST /me/plan/regenerate → job plan.generate (202); dùng cài đặt hiện tại + enrollment mới nhất (mục tiêu/ngày thi) */
  async regenerate(userId: string, program: ProgramCode): Promise<{ job_id: string; status: 'queued' | 'running' | 'completed' | 'failed'; plan_id: string | null }> {
    await this.assertEnabled(userId, program);
    await this.gate.check(userId, program, 'study_plan');
    const tree = await this.currentTree(userId, program);
    if (!tree) throw new NotFound('study_plan', program);
    const d = await this.jobs.dispatch('grading', JOB_NAMES.PLAN_GENERATE, `${tree.plan.id}`, { user_id: userId, program });
    if (d.mode === 'inline' && d.done) {
      const r = (await d.done.catch(() => null)) as { plan_id?: string } | null;
      return { job_id: d.jobId, status: r?.plan_id ? 'completed' : 'failed', plan_id: r?.plan_id ?? null };
    }
    return { job_id: d.jobId, status: 'queued', plan_id: null };
  }

  /** Bộ xử lý job plan.generate */
  async regenerateNow(userId: string, program: ProgramCode): Promise<string> {
    const tree = await this.currentTree(userId, program);
    if (!tree) throw new NotFound('study_plan', program);
    const { tz } = await this.userCtx(userId);
    const enrollment = await this.enrollments.get(userId, program);
    const today = localDate(this.clock.now(), tz);
    const prev = tree.strategy.settings;
    const examDate = enrollment?.examDate && enrollment.examDate > today ? enrollment.examDate : prev.exam_date && prev.exam_date > today ? prev.exam_date : null;
    const settings: PlanSettings = { ...prev, timezone: tz, start_date: today, exam_date: examDate, target_score: enrollment?.targetScore !== null && enrollment?.targetScore !== undefined ? Number(enrollment.targetScore) : prev.target_score };
    return this.generate(userId, program, settings, 'regenerate');
  }

  private async assertEnabled(userId: string, program: string): Promise<void> {
    if (!(await this.flags.isEnabled(STUDY_PLAN_FLAG, { userId, program }, true))) throw new FeatureDisabled(STUDY_PLAN_FLAG);
  }

  /** Mastery của người học → đầu vào PlanGenerator (subskill → các Part đo subskill đó) */
  async masteryRows(userId: string, program: string): Promise<MasteryRow[]> {
    const [rows, subs] = await Promise.all([
      this.dbs.db.select().from(learnSkillMastery).where(and(eq(learnSkillMastery.userId, userId), eq(learnSkillMastery.programCode, program))),
      this.catalog.subskillSections(program),
    ]);
    return rows.flatMap((r) => {
      const s = subs.get(r.subskillId);
      return s && s.sections.length ? [{ subskill: s.code, skill: s.skill, sections: s.sections, mastery: Number(r.mastery) }] : [];
    });
  }

  /** Sinh + lưu một phiên bản lộ trình (phiên bản cũ is_current = false, giữ lịch sử) */
  async generate(userId: string, program: string, settings: PlanSettings, reason: 'onboarding' | 'regenerate'): Promise<string> {
    const [ctx, mastery, content, enrollment] = await Promise.all([this.gate.context(userId, program), this.masteryRows(userId, program), this.catalog.planContent(program), this.enrollments.ensure(userId, program as ProgramCode)]);
    const inventory = toInventory(content);
    const input = { program, startDate: settings.start_date, examDate: settings.exam_date, weeklyMinutes: settings.weekly_minutes, studyDays: settings.study_days, isPro: ctx.isPro, mastery, inventory };
    const generated = generatePlan(input);
    const violations = validatePlan(generated, input);
    if (violations.length) {
      this.logger.error({ violations: violations.slice(0, 5) }, 'generated plan violates constraints');
      throw new Error('plan generator produced an invalid plan');
    }
    const level = (enrollment.currentLevel ?? {}) as { overall?: number; listening?: number; reading?: number; low?: number; high?: number; source?: string };
    // C3: thang band (IELTS) – chẩn đoán không có overall (cần đủ 4 kỹ năng) → mốc = trung bình band Listening/Reading đã ước tính
    const bands = [level.listening, level.reading].filter((x): x is number => typeof x === 'number');
    const bandMean = programDef(program)?.scale.kind === 'band' && bands.length ? ieltsRoundOverall(bands.reduce((a, b) => a + b, 0) / bands.length) : null;
    const baseline = typeof level.overall === 'number' ? { score: level.overall, low: level.low ?? null, high: level.high ?? null, source: level.source ?? 'diagnostic' } : bandMean !== null ? { score: bandMean, low: null, high: null, source: level.source ?? 'diagnostic' } : null;
    // C1: gợi ý mục tiêu theo thang của chương trình (registry) – TOEIC và band IELTS (C3) có mô hình tốc độ tăng điểm
    const suggestion = baseline?.score !== null && baseline?.score !== undefined ? suggestTargetFor(programDef(program)?.scale.kind ?? 'points', { current: baseline.score, today: settings.start_date, examDate: settings.exam_date, weeklyMinutes: settings.weekly_minutes, desired: settings.target_score }) : null;
    const strategy: StoredStrategy = {
      ...generated.strategy,
      settings,
      weeks_meta: generated.weeks.map((w) => ({ week_no: w.week_no, end_date: w.end_date, budget_minutes: w.budget_minutes, phase: w.phase, study_dates: w.study_dates })),
      baseline,
      target_suggestion: suggestion ? { suggested: suggestion.suggested, feasible: suggestion.feasible } : null,
      mastery_path: null,
      is_pro: ctx.isPro,
    };
    const skillIdByCode = new Map(content.sections.map((s) => [s.skill, s.skill_id]));
    const sectionIdByCode = new Map(content.sections.map((s) => [s.code, s.id]));
    const planId = await this.dbs.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`plan:${enrollment.id}`}))`);
      const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(${learnStudyPlans.versionNo}), 0)`.mapWith(Number) }).from(learnStudyPlans).where(eq(learnStudyPlans.enrollmentId, enrollment.id));
      await tx.update(learnStudyPlans).set({ isCurrent: false }).where(and(eq(learnStudyPlans.enrollmentId, enrollment.id), eq(learnStudyPlans.isCurrent, true)));
      // Đề xuất điều chỉnh của phiên bản cũ không còn áp dụng được
      await tx.update(learnPlanAdjustments).set({ status: 'superseded' }).where(and(eq(learnPlanAdjustments.userId, userId), inArray(learnPlanAdjustments.status, ['pending', 'ready', 'needs_clarification'])));
      const [plan] = await tx.insert(learnStudyPlans).values({ enrollmentId: enrollment.id, versionNo: max + 1, strategy, generatedBy: 'rule', isCurrent: true, generatedAt: this.now() }).returning({ id: learnStudyPlans.id });
      for (const w of generated.weeks) {
        const [week] = await tx
          .insert(learnPlanWeeks)
          .values({ planId: plan!.id, weekNo: w.week_no, startDate: w.start_date, focusSkillId: w.focus_skill ? (skillIdByCode.get(w.focus_skill) ?? null) : null, focusSectionId: w.focus_section ? (sectionIdByCode.get(w.focus_section) ?? null) : null, loadMinutes: w.load_minutes })
          .returning({ id: learnPlanWeeks.id });
        if (w.tasks.length)
          await tx.insert(learnPlanTasks).values(w.tasks.map((t) => ({ planWeekId: week!.id, dueDate: t.due_date, taskType: t.task_type, refType: t.ref_type, refId: t.ref_id, title: t.title, estMinutes: t.est_minutes, status: 'pending' as const, evidence: t.evidence })));
      }
      await this.outbox.write(tx, { aggregateType: 'study_plan', aggregateId: plan!.id, eventType: DOMAIN_EVENTS.PLAN_GENERATED, payload: { plan_id: plan!.id, user_id: userId, program, version_no: max + 1, reason, weeks: generated.weeks.length } });
      return plan!.id;
    });
    this.realtime.emitToUser(userId, 'plan.updated', { plan_id: planId, program, reason: 'generated' });
    this.logger.info({ plan_id: planId, weeks: generated.weeks.length, reason }, 'study plan generated');
    return planId;
  }

  // ------------------------------------------------------------------ đọc
  async get(userId: string, program: string): Promise<StudyPlan> {
    const tree = await this.currentTree(userId, program);
    if (!tree) throw new NotFound('study_plan', program);
    return this.toDto(tree, await this.userCtx(userId));
  }

  async toDto(tree: PlanTree, ctx: { today: string; locale: string }): Promise<StudyPlan> {
    const { strategy, weeks, tasks } = tree;
    const entitlement = await this.gate.context(tree.enrollment.userId, tree.enrollment.programCode);
    const isPro = entitlement.isPro;
    const cur = this.weekIndexOf(tree, ctx.today);
    const lockedFrom = isPro ? null : cur + 2;
    const content = await this.catalog.planContent(tree.enrollment.programCode);
    const sectionCode = new Map(content.sections.map((s) => [s.id, s.code]));
    const skillCode = new Map(content.sections.map((s) => [s.skill_id, s.skill]));
    const counts = await this.liveCounts(tree.enrollment.userId, tree.enrollment.programCode, tasks);
    const weekDtos = weeks.map((w) =>
      weekDto(
        w,
        tasks.filter((t) => t.planWeekId === w.id),
        strategy.weeks_meta?.find((m) => m.week_no === w.weekNo),
        { today: ctx.today, locale: ctx.locale, locked: lockedFrom !== null && w.weekNo >= lockedFrom, focusSection: w.focusSectionId ? (sectionCode.get(w.focusSectionId) ?? null) : null, focusSkill: w.focusSkillId ? (skillCode.get(w.focusSkillId) ?? null) : null },
      ),
    );
    for (const wk of weekDtos) for (const d of wk.days) d.tasks = d.tasks.map((t) => this.withCounts(t, counts, ctx.today));
    const progress = toProgressTasks(tasks);
    const curTasks = weeks[cur] ? toProgressTasks(tasks.filter((t) => t.planWeekId === weeks[cur]!.id)) : [];
    const fc = forecastStatus(progress, ctx.today);
    const exam = examProgress(strategy.settings.start_date, strategy.settings.exam_date, ctx.today);
    const latest = (await this.attempts.statsSource(tree.enrollment.userId, tree.enrollment.programCode)).find((a) => a.scaled !== null && (a.mode === 'exam' || a.mode === 'diagnostic'));
    return {
      id: tree.plan.id,
      program: tree.enrollment.programCode as ProgramCode,
      version_no: tree.plan.versionNo,
      generated_by: tree.plan.generatedBy,
      generated_at: tree.plan.generatedAt.toISOString(),
      target: { score: strategy.settings.target_score, exam_date: strategy.settings.exam_date, suggested: strategy.target_suggestion?.suggested ?? null, feasible: strategy.target_suggestion?.feasible ?? null },
      predicted_now: latest ? Number(latest.scaled) : (strategy.baseline?.score ?? null),
      baseline: strategy.baseline,
      weeks_total: weeks.length,
      week_current: weeks.length ? cur + 1 : null,
      progress_pct: weekProgress(progress).pct,
      minutes_per_skill: strategy.minutes_per_skill ?? {},
      mastery_path: null,
      weeks: weekDtos,
      locked_weeks_from: lockedFrom,
      settings: strategy.settings,
      progress: { week_pct: weekProgress(curTasks).pct, plan_pct: weekProgress(progress).pct, exam_pct: exam.pct, days_to_exam: exam.days_left, forecast: fc.status, forecast_ratio: fc.ratio },
      is_pro: isPro,
      full_test_every_weeks: strategy.full_test_every_weeks,
    };
  }

  /** GET /me/plan/today */
  async today(userId: string, program: string): Promise<PlanToday> {
    const ctx = await this.userCtx(userId);
    const [tree, streak] = await Promise.all([this.currentTree(userId, program), this.gamification.streakView(userId, program)]);
    const base = { date: ctx.today, timezone: ctx.tz, studied_today: streak.studied_today, streak: { current: streak.current, at_risk: streak.at_risk, freeze_available: streak.freeze_available } };
    if (!tree) return { ...base, plan_id: null, focus: null, tasks: [], overdue: [], warmup: null, quick: { minutes: 0, items: [] }, week: null };
    const todayRows = tree.tasks.filter((t) => t.dueDate === ctx.today);
    const overdueRows = tree.tasks.filter((t) => t.status === 'pending' && t.dueDate < ctx.today);
    const cur = tree.weeks[this.weekIndexOf(tree, ctx.today)];
    const weekTasks = cur ? tree.tasks.filter((t) => t.planWeekId === cur.id) : [];
    const checkin = weekTasks.find((t) => t.taskType === 'checkin');
    const quick = quickSuggestion([...todayRows, ...overdueRows].map((t) => ({ id: t.id, due_date: t.dueDate, task_type: t.taskType, est_minutes: t.estMinutes ?? 0, status: t.status })));
    const warm = todayRows.find((t) => t.taskType === 'vocab_review' && t.status === 'pending') ?? null;
    const content = cur?.focusSectionId ? await this.catalog.planContent(program) : null;
    const counts = await this.liveCounts(userId, program, [...todayRows, ...overdueRows]);
    const dto = (t: TaskRow) => this.withCounts(taskDto(t, ctx.today, ctx.locale), counts, ctx.today);
    return {
      ...base,
      plan_id: tree.plan.id,
      focus: cur?.focusSectionId ? (content?.sections.find((s) => s.id === cur.focusSectionId)?.code ?? null) : null,
      tasks: todayRows.map(dto),
      overdue: overdueRows.map(dto),
      warmup: warm ? dto(warm) : null,
      quick: { minutes: quick.minutes, items: quick.items.map((i) => ({ task_id: i.task.id, est_minutes: i.est_minutes, shortened: i.shortened })) },
      week: cur ? { id: cur.id, week_no: cur.weekNo, progress_pct: weekProgress(toProgressTasks(weekTasks)).pct, checkin_due: !cur.checkinDoneAt && !!checkin && checkin.dueDate <= ctx.today, checkin_done: !!cur.checkinDoneAt } : null,
    };
  }

  // ------------------------------------------------------------------ task
  /** Task + quyền sở hữu (task → tuần → lộ trình → enrollment) */
  async ownedTask(userId: string, taskId: string, db: DbOrTx = this.dbs.db, lock = false): Promise<{ task: TaskRow; week: WeekRow; plan: PlanRow }> {
    // Khoá riêng hàng task (FOR UPDATE OF với tên bảng có schema không hợp lệ trong Postgres)
    if (lock) await db.select({ id: learnPlanTasks.id }).from(learnPlanTasks).where(eq(learnPlanTasks.id, taskId)).for('update');
    const [row] = await db.select({ task: learnPlanTasks, week: learnPlanWeeks, plan: learnStudyPlans }).from(learnPlanTasks).innerJoin(learnPlanWeeks, eq(learnPlanWeeks.id, learnPlanTasks.planWeekId)).innerJoin(learnStudyPlans, eq(learnStudyPlans.id, learnPlanWeeks.planId)).where(eq(learnPlanTasks.id, taskId)).limit(1);
    if (!row) throw new NotFound('plan_task', taskId);
    const [enr] = await this.enrollments.byIds([row.plan.enrollmentId]);
    if (!enr || enr.userId !== userId) throw new Forbidden();
    return row;
  }

  /** PATCH /plan-tasks/{taskId}: done/skipped/pending, gắn kết quả, đổi ngày trong cùng tuần */
  async patchTask(userId: string, taskId: string, patch: PlanTaskPatch): Promise<PlanTask> {
    const ctx = await this.userCtx(userId);
    if (patch.result_ref?.attempt_id) {
      const a = await this.attempts.brief(userId, patch.result_ref.attempt_id);
      if (!a) throw new ValidationFailed({ issues: [{ path: 'result_ref.attempt_id', message: 'attempt not found' }] });
      if (a.status !== 'graded') throw new ValidationFailed({ issues: [{ path: 'result_ref.attempt_id', message: 'attempt is not graded yet' }] });
    }
    const out = await this.dbs.db.transaction(async (tx) => {
      const { task, week, plan } = await this.ownedTask(userId, taskId, tx, true);
      const strategy = plan.strategy as StoredStrategy;
      const meta = strategy.weeks_meta?.find((m) => m.week_no === week.weekNo);
      const set: Partial<typeof learnPlanTasks.$inferInsert> = {};
      let completedNow = false;
      if (patch.due_date && patch.due_date !== task.dueDate) {
        if (task.status !== 'pending') throw new ValidationFailed({ issues: [{ path: 'due_date', message: 'only pending tasks can be rescheduled' }] });
        const end = meta?.end_date ?? addDays(week.startDate, 6);
        if (patch.due_date < week.startDate || patch.due_date > end) throw new ValidationFailed({ issues: [{ path: 'due_date', message: 'due_date must stay within the same plan week', week_start: week.startDate, week_end: end }] });
        if (patch.due_date < ctx.today) throw new ValidationFailed({ issues: [{ path: 'due_date', message: 'due_date cannot be in the past' }] });
        if (strategy.settings.exam_date && patch.due_date >= strategy.settings.exam_date) throw new ValidationFailed({ issues: [{ path: 'due_date', message: 'due_date must be before exam_date' }] });
        set.dueDate = patch.due_date;
      }
      if (patch.status && patch.status !== task.status) {
        if (patch.status === 'done') {
          set.status = 'done';
          set.completedAt = this.now();
          completedNow = true;
        } else if (patch.status === 'skipped') {
          if (task.status === 'done') throw new ValidationFailed({ issues: [{ path: 'status', message: 'done task cannot be skipped' }] });
          set.status = 'skipped';
        } else {
          set.status = 'pending';
          set.completedAt = null;
          if (task.status === 'expired' && task.dueDate < ctx.today) set.dueDate = set.dueDate ?? ctx.today;
        }
      }
      if (patch.result_ref) set.resultRef = { ...((task.resultRef) ?? {}), ...patch.result_ref, source: 'manual' };
      if (Object.keys(set).length) await tx.update(learnPlanTasks).set(set).where(eq(learnPlanTasks.id, taskId));
      if (completedNow) {
        await this.outbox.write(tx, { aggregateType: 'plan_task', aggregateId: taskId, eventType: DOMAIN_EVENTS.PLAN_TASK_COMPLETED, payload: { task_id: taskId, user_id: userId, plan_id: plan.id, task_type: task.taskType, source: patch.result_ref ? 'manual_result' : 'manual' } });
        // Việc tự báo (ôn từ vựng/bài học) chưa có sự kiện kiểm chứng ở S9 → XP nhỏ + tính ngày học
        if (SELF_REPORTED_TYPES.has(task.taskType) && !patch.result_ref?.attempt_id) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gamification:${userId}`}))`);
          const xp = await this.gamification.awardXp(tx, userId, 'plan_task_done', XP_TABLE.plan_task_done, { type: 'plan_task', id: taskId });
          if (xp) await this.gamification.recordStudyDay(tx, userId, (await this.enrollments.byIds([plan.enrollmentId]))[0]?.programCode ?? DEFAULT_PROGRAM);
        }
      }
      const [fresh] = await tx.select().from(learnPlanTasks).where(eq(learnPlanTasks.id, taskId));
      await this.refreshWeekLoad(tx, week.id);
      return fresh!;
    });
    this.realtime.emitToUser(userId, 'plan.updated', { task_id: taskId, reason: 'task_updated' });
    return taskDto(out, ctx.today, ctx.locale);
  }

  /** load_minutes của tuần = tổng phút task trừ skipped/expired */
  async refreshWeekLoad(tx: DbOrTx, weekId: string): Promise<void> {
    await tx.execute(sql`update learn.plan_weeks w set load_minutes = coalesce((select sum(coalesce(t.est_minutes, 0)) from learn.plan_tasks t where t.plan_week_id = w.id and t.status not in ('skipped','expired')), 0) where w.id = ${weekId}::uuid`);
  }

  // ------------------------------------------------------------------ S10: thẻ đến hạn / sổ lỗi
  /** Số thẻ đến hạn + lỗi chưa hiểu (chỉ truy vấn khi có task vocab_review/review_errors) */
  private async liveCounts(userId: string, program: string, tasks: TaskRow[]): Promise<{ srs: number | null; errors: number | null }> {
    const needSrs = tasks.some((t) => t.taskType === 'vocab_review');
    const needErr = tasks.some((t) => t.taskType === 'review_errors');
    const [srs, errors] = await Promise.all([needSrs ? this.srs.dueSummary(userId, program).then((r) => r.total).catch(() => null) : null, needErr ? this.errorLog.totals(userId, program).then((r) => r.open).catch(() => null) : null]);
    return { srs, errors };
  }

  /** Gắn số liệu sống cho task hôm nay/sắp tới (quá khứ đã chốt → null) */
  private withCounts(t: PlanTask, counts: { srs: number | null; errors: number | null }, today: string): PlanTask {
    const live = t.status === 'pending' && t.due_date >= addDays(today, -TASK_EXPIRE_AFTER_DAYS);
    if (t.task_type === 'vocab_review') return { ...t, srs_due: live ? counts.srs : null };
    if (t.task_type === 'review_errors') return { ...t, errors_open: live ? counts.errors : null };
    return t;
  }

  /** Ôn hết thẻ đến hạn (kể cả thẻ mới trong hạn mức) → task vocab_review hôm nay done */
  @OnEvent(`local.${SRS_REVIEWED_EVENT}`)
  async onSrsReviewed(ev: SrsReviewedEvent): Promise<void> {
    if (!ev?.user_id || ev.reviewed <= 0 || ev.due_now_left !== 0) return;
    for (const program of ev.programs) await this.completeTodayOfType(ev.user_id, program, 'vocab_review', { source: 'srs', reviewed: ev.reviewed }).catch((err: Error) => this.logger.warn({ err: err.message }, 'vocab_review auto-complete failed'));
  }

  /** Đã hiểu ≥ 10 lỗi hôm nay hoặc hết lỗi chưa hiểu → task review_errors done */
  @OnEvent(`local.${ERROR_RESOLVED_EVENT}`)
  async onErrorResolved(ev: ErrorResolvedEvent): Promise<void> {
    if (!ev?.user_id || (ev.open_left > 0 && ev.resolved_today < REVIEW_ERRORS_DONE_AT)) return;
    await this.completeTodayOfType(ev.user_id, ev.program, 'review_errors', { source: 'error_log', resolved_today: ev.resolved_today }).catch((err: Error) => this.logger.warn({ err: err.message }, 'review_errors auto-complete failed'));
  }

  /** Task pending loại `type` hôm nay (hoặc quá hạn ≤ 3 ngày, gần nhất trước) của lộ trình hiện tại → done */
  async completeTodayOfType(userId: string, program: string, type: TaskRow['taskType'], result: Record<string, unknown>): Promise<string | null> {
    const ctx = await this.userCtx(userId);
    const id = await this.dbs.db.transaction(async (tx) => {
      const tree = await this.currentTree(userId, program, tx);
      if (!tree) return null;
      const from = addDays(ctx.today, -TASK_EXPIRE_AFTER_DAYS);
      const pick = tree.tasks.filter((t) => t.taskType === type && t.status === 'pending' && t.dueDate <= ctx.today && t.dueDate >= from).sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
      if (!pick) return null;
      const [locked] = await tx.select().from(learnPlanTasks).where(eq(learnPlanTasks.id, pick.id)).for('update');
      return this.markDone(tx, locked!, tree.plan.id, userId, { ...result, at: this.now().toISOString() });
    });
    if (id) this.realtime.emitToUser(userId, 'plan.updated', { task_id: id, reason: 'task_done' });
    return id;
  }

  // ------------------------------------------------------------------ tự hoàn thành từ outbox
  @OnEvent('local.attempt.graded')
  async onLocalGraded(p: GradedPayload): Promise<void> {
    await this.completeFromAttempt(p).catch((err: Error) => this.logger.warn({ err: err.message, attempt_id: p?.attempt_id }, 'plan task auto-complete failed'));
  }

  @OnEvent('outbox.attempt.graded')
  async onOutboxGraded(ev: { payload: GradedPayload }): Promise<void> {
    await this.onLocalGraded(ev.payload);
  }

  @OnEvent('outbox.lesson.completed')
  async onLessonCompleted(ev: { payload: { user_id: string; lesson_id: string; program?: string } }): Promise<void> {
    const p = ev.payload;
    if (!p?.user_id || !p.lesson_id) return;
    await this.completeMatching(p.user_id, p.program ?? DEFAULT_PROGRAM, { kind: 'lesson', id: p.lesson_id }, { lesson_id: p.lesson_id }).catch((err: Error) => this.logger.warn({ err: err.message }, 'lesson auto-complete failed'));
  }

  /**
   * attempt.graded → task tương ứng `done` + `result_ref.attempt_id` (idempotent): (1) attempt có `plan_task_id` của chính người
   * dùng; (2) không có → task pending của lộ trình hiện tại cùng nội dung (test set / section) trong cửa sổ [hôm nay − 3, cuối tuần
   * hiện tại], ưu tiên hôm nay → quá hạn gần nhất → sắp tới.
   */
  async completeFromAttempt(p: GradedPayload): Promise<string | null> {
    if (!p?.attempt_id || !p.user_id) return null;
    const result = { attempt_id: p.attempt_id, scaled_score: p.scaled_score ?? null, correct: p.correct ?? null, total: p.total ?? null };
    if (p.plan_task_id) {
      const done = await this.dbs.db.transaction(async (tx) => {
        let owned: Awaited<ReturnType<PlanService['ownedTask']>>;
        try {
          owned = await this.ownedTask(p.user_id, p.plan_task_id!, tx, true);
        } catch {
          return null;
        }
        return this.markDone(tx, owned.task, owned.plan.id, p.user_id, result);
      });
      if (done !== null) return done;
    }
    const ref = p.test_set_id ? { kind: 'test_set' as const, id: p.test_set_id } : p.section_id ? { kind: 'section' as const, id: p.section_id } : null;
    if (!ref) return null;
    return this.completeMatching(p.user_id, p.program ?? DEFAULT_PROGRAM, ref, result, p.mode);
  }

  private async completeMatching(userId: string, program: string, ref: { kind: 'test_set' | 'section' | 'lesson'; id: string }, result: Record<string, unknown>, mode?: string): Promise<string | null> {
    const ctx = await this.userCtx(userId);
    const id = await this.dbs.db.transaction(async (tx) => {
      const tree = await this.currentTree(userId, program, tx);
      if (!tree) return null;
      if (tree.tasks.some((t) => (t.resultRef as { attempt_id?: string } | null)?.attempt_id === result.attempt_id && result.attempt_id)) return null;
      const cur = tree.weeks[this.weekIndexOf(tree, ctx.today)];
      const weekEnd = cur ? (tree.strategy.weeks_meta?.find((m) => m.week_no === cur.weekNo)?.end_date ?? addDays(cur.startDate, 6)) : ctx.today;
      const from = addDays(ctx.today, -TASK_EXPIRE_AFTER_DAYS);
      const cands = tree.tasks.filter(
        (t) =>
          (t.status === 'pending' || t.status === 'expired') &&
          t.refType === ref.kind &&
          t.refId === ref.id &&
          t.dueDate >= from &&
          t.dueDate <= weekEnd &&
          // đề full chỉ tính khi làm ở Exam Mode
          (t.taskType !== 'full_test' || !mode || mode === 'exam'),
      );
      const score = (t: TaskRow) => (t.dueDate === ctx.today ? 0 : t.dueDate < ctx.today ? 1 + daysBetween(t.dueDate, ctx.today) / 10 : 2 + daysBetween(ctx.today, t.dueDate) / 10) + (t.status === 'expired' ? 0.5 : 0);
      const pick = [...cands].sort((a, b) => score(a) - score(b))[0];
      if (!pick) return null;
      const [locked] = await tx.select().from(learnPlanTasks).where(eq(learnPlanTasks.id, pick.id)).for('update');
      return this.markDone(tx, locked!, tree.plan.id, userId, result);
    });
    if (id) this.realtime.emitToUser(userId, 'plan.updated', { task_id: id, reason: 'task_done' });
    return id;
  }

  private async markDone(tx: Tx, task: TaskRow, planId: string, userId: string, result: Record<string, unknown>): Promise<string | null> {
    const prev = (task.resultRef as { attempt_id?: string } | null) ?? null;
    if (task.status === 'done' || (prev?.attempt_id && prev.attempt_id === result.attempt_id)) return task.status === 'done' ? task.id : null;
    if (task.status === 'skipped') return null;
    await tx.update(learnPlanTasks).set({ status: 'done', completedAt: this.now(), resultRef: { ...(prev ?? {}), ...result, source: 'auto' } }).where(eq(learnPlanTasks.id, task.id));
    await this.refreshWeekLoad(tx, task.planWeekId);
    await this.outbox.write(tx, { aggregateType: 'plan_task', aggregateId: task.id, eventType: DOMAIN_EVENTS.PLAN_TASK_COMPLETED, payload: { task_id: task.id, user_id: userId, plan_id: planId, task_type: task.taskType, source: 'auto', ...result } });
    return task.id;
  }

  // ------------------------------------------------------------------ job
  /** plan.expire_tasks: task pending có ngày ≤ hôm nay − 3 (giờ người học, theo settings.timezone) → expired; đề xuất quá hạn → expired */
  async expireDue(at: Date = this.now()): Promise<{ expired_tasks: number; expired_proposals: number }> {
    const rows = await this.dbs.db.execute<{ id: string }>(sql`
      update learn.plan_tasks t set status = 'expired'
        from learn.plan_weeks w, learn.study_plans p
       where t.plan_week_id = w.id and w.plan_id = p.id and p.is_current and t.status = 'pending'
         and t.due_date <= ((${at.toISOString()}::timestamptz at time zone coalesce(p.strategy -> 'settings' ->> 'timezone', ${DEFAULT_TZ}))::date - ${TASK_EXPIRE_AFTER_DAYS}::int)
      returning t.id, w.id as week_id`);
    const weekIds = [...new Set([...rows].map((r) => (r as unknown as { week_id: string }).week_id))];
    for (const w of weekIds) await this.refreshWeekLoad(this.dbs.db, w);
    const props = await this.dbs.db
      .update(learnPlanAdjustments)
      .set({ status: 'expired' })
      .where(and(inArray(learnPlanAdjustments.status, ['pending', 'ready', 'needs_clarification']), lt(learnPlanAdjustments.expiresAt, at)))
      .returning({ id: learnPlanAdjustments.id });
    if (rows.length || props.length) this.logger.info({ tasks: rows.length, proposals: props.length }, 'plan.expire_tasks');
    return { expired_tasks: rows.length, expired_proposals: props.length };
  }

  // ------------------------------------------------------------------ cho growth (nhắc học) & stats
  /** Lộ trình hiện tại có giờ nhắc (growth lọc theo giờ người học) */
  async reminderCandidates(limit = 5000): Promise<Array<{ userId: string; program: string; planId: string; reminderTime: string; timezone: string }>> {
    const plans = await this.dbs.db
      .select({ id: learnStudyPlans.id, enrollmentId: learnStudyPlans.enrollmentId, strategy: learnStudyPlans.strategy })
      .from(learnStudyPlans)
      .where(and(eq(learnStudyPlans.isCurrent, true), isNotNull(sql`${learnStudyPlans.strategy} -> 'settings' ->> 'reminder_time'`)))
      .limit(limit);
    const enr = new Map((await this.enrollments.byIds(plans.map((p) => p.enrollmentId))).map((e) => [e.id, e]));
    return plans.flatMap((p) => {
      const e = enr.get(p.enrollmentId);
      const s = (p.strategy as StoredStrategy).settings;
      return e && e.isActive && s?.reminder_time ? [{ userId: e.userId, program: e.programCode, planId: p.id, reminderTime: s.reminder_time, timezone: s.timezone }] : [];
    });
  }

  /** Việc còn lại hôm nay (nội dung nhắc học) */
  async todaySummary(userId: string, program: string): Promise<{ minutes: number; tasks: number }> {
    const t = await this.today(userId, program);
    const pending = [...t.tasks, ...t.overdue].filter((x) => x.status === 'pending');
    return { minutes: pending.reduce((a, x) => a + x.est_minutes, 0), tasks: pending.length };
  }

  /** Tóm tắt cho GET /me/stats */
  async summary(userId: string, program: string): Promise<{ plan_id: string; week_pct: number; forecast: string; days_to_exam: number | null } | null> {
    const tree = await this.currentTree(userId, program);
    if (!tree) return null;
    const { today } = await this.userCtx(userId);
    const cur = tree.weeks[this.weekIndexOf(tree, today)];
    const exam = examProgress(tree.strategy.settings.start_date, tree.strategy.settings.exam_date, today);
    return { plan_id: tree.plan.id, week_pct: cur ? weekProgress(toProgressTasks(tree.tasks.filter((t) => t.planWeekId === cur.id))).pct : 0, forecast: forecastStatus(toProgressTasks(tree.tasks), today).status, days_to_exam: exam.days_left };
  }
}
