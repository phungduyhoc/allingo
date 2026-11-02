import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { WEEKDAYS, addDays, applyAdjustOps, inventoryIndex, taskRefIsReal, type AdjustContext, type AdjustViolation, type AdjustWeek } from '@allingo/planner';
import { DOMAIN_EVENTS, JOB_NAMES, XP_TABLE, planAdjustOutputSchema, type PlanAdjustOutput, type PlanAdjustProposal, type PlanCheckinInput, type PlanTask, type PlanWeek, type ProgramCode } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../../shared/db/db.module.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { PersonalDataRegistry } from '../../../shared/events/personal-data.registry.js';
import { Conflict, Forbidden, InsufficientCredits, NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { JobsService } from '../../../shared/queue/jobs.service.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { AiGatewayService, GuardrailsService } from '../../ai-gateway/index.js';
import { CreditService, FeatureGateService } from '../../billing/index.js';
import { CatalogQueryService } from '../../catalog/index.js';
import { EnrollmentsService, UsersService } from '../../iam/index.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { stripPromptTags } from '../tutor/context-builder.js';
import { PROPOSAL_TTL_HOURS, taskDto, toInventory, weekDto, type AdjustmentRow, type StoredStrategy, type TaskRow } from './plan-mapper.js';
import { PlanService, type PlanTree } from './plan.service.js';

const { learnPlanAdjustments, learnPlanWeeks, learnPlanTasks, learnStudyPlans } = schema;

interface StoredResult {
  scope_week_ids: string[];
  before: PlanTask[];
  after: PlanTask[];
  changes: PlanAdjustProposal['changes'];
  violations: AdjustViolation[];
  minutes_before: number;
  minutes_after: number;
  budget_minutes: number;
  max_minutes: number | null;
  settings_patch: { reminder_time?: string } | null;
  error?: string;
}

interface StoredInput {
  feeling?: string | null;
  actual_minutes?: number | null;
  difficulties?: string | null;
  difficulties_blocked?: boolean;
  availability_next_week?: { minutes?: number; days?: string[]; note?: string } | null;
  instruction?: string | null;
  from_week_id?: string | null;
}

const loadOf = (tasks: Array<{ status: string; est_minutes: number }>) => tasks.filter((t) => t.status !== 'skipped' && t.status !== 'expired').reduce((a, t) => a + t.est_minutes, 0);

/**
 * Check-in tuần & điều chỉnh lộ trình (Sprint 9): `POST /me/plan/checkin` (cảm nhận, giờ thực tế, khó khăn – văn bản tự do qua
 * guard + che PII, bọc <user_input>) → job `plan.adjust` → AiGateway `plan_adjust` (prompt registry, Zod) → server áp dụng thử
 * ops bằng @allingo/planner (ràng buộc: không vượt phút/tuần & thời gian rảnh khai báo, chỉ tuần tới / không sửa quá khứ, task
 * trỏ nội dung có thật) → đề xuất `ready` hoặc `rejected` (lưu lịch sử learn.plan_adjustments) → `POST …/apply` (transaction,
 * kiểm tra lại trên dữ liệu mới nhất). Câu lệnh tự nhiên (`POST /me/plan/adjust`) cùng luồng, tính credit; check-in thì không.
 */
@Injectable()
export class PlanAdjustService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'learning.plan_adjust' });

  constructor(
    private readonly dbs: DbService,
    private readonly plans: PlanService,
    private readonly gateway: AiGatewayService,
    private readonly guard: GuardrailsService,
    private readonly gate: FeatureGateService,
    private readonly credits: CreditService,
    private readonly catalog: CatalogQueryService,
    private readonly enrollments: EnrollmentsService,
    private readonly users: UsersService,
    private readonly gamification: GamificationService,
    private readonly jobs: JobsService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeGateway,
    private readonly personalData: PersonalDataRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.jobs.register('grading', JOB_NAMES.PLAN_ADJUST, (p) => this.run(String(p.proposal_id)));
    // Check-in chứa văn bản tự do (đã che PII) – xoá khi người dùng yêu cầu xoá tài khoản (CLAUDE.md §9)
    this.personalData.register('learning.plan_adjustments', async (userId) => {
      const rows = await this.dbs.db.update(learnPlanAdjustments).set({ input: {}, proposal: null, result: null }).where(eq(learnPlanAdjustments.userId, userId)).returning({ id: learnPlanAdjustments.id });
      return rows.length;
    });
  }

  private now(): Date {
    return new Date(this.clock.now());
  }

  /** Guard văn bản tự do của người học: cho qua → bản đã che PII (bỏ thẻ prompt); chặn/guard lỗi → null */
  private async screen(userId: string, text: string | undefined, program: string): Promise<{ text: string | null; blocked: boolean; refusal: string | null }> {
    const raw = text?.trim();
    if (!raw) return { text: null, blocked: false, refusal: null };
    const d = await this.guard.check(userId, raw, { mode: 'input', examMode: false, taskCode: 'plan_adjust', program });
    if (!d.allowed) return { text: null, blocked: true, refusal: d.refusalCode ?? (d.source === 'unavailable' ? 'unavailable' : 'unsafe') };
    return { text: stripPromptTags(d.text).slice(0, 600), blocked: false, refusal: null };
  }

  // ------------------------------------------------------------------ check-in
  async checkin(userId: string, input: PlanCheckinInput): Promise<PlanWeek & { adjust: { proposal_id: string; status: PlanAdjustProposal['status'] } | null; xp_earned: number; difficulties_used: boolean }> {
    await this.gate.check(userId, input.program, 'study_plan');
    const tree = await this.plans.currentTree(userId, input.program);
    if (!tree) throw new NotFound('study_plan', input.program);
    const ctx = await this.plans.userCtx(userId);
    const idx = this.plans.weekIndexOf(tree, ctx.today);
    const cur = tree.weeks[idx]!;
    const next = tree.weeks[idx + 1] ?? null;
    const free = [input.difficulties, input.availability_next_week?.note].filter(Boolean).join('\n');
    const screened = await this.screen(userId, free || undefined, input.program);
    const stored: StoredInput = {
      feeling: input.feeling ?? null,
      actual_minutes: input.actual_minutes ?? null,
      difficulties: screened.text,
      difficulties_blocked: screened.blocked,
      availability_next_week: input.availability_next_week ? { ...(input.availability_next_week.minutes !== undefined ? { minutes: input.availability_next_week.minutes } : {}), ...(input.availability_next_week.days ? { days: input.availability_next_week.days } : {}) } : null,
      from_week_id: cur.id,
    };
    const { proposalId, xp } = await this.dbs.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gamification:${userId}`}))`);
      await tx.update(learnPlanWeeks).set({ checkinDoneAt: this.now() }).where(eq(learnPlanWeeks.id, cur.id));
      await tx
        .update(learnPlanTasks)
        .set({ status: 'done', completedAt: this.now(), resultRef: { source: 'checkin' } })
        .where(and(eq(learnPlanTasks.planWeekId, cur.id), eq(learnPlanTasks.taskType, 'checkin'), inArray(learnPlanTasks.status, ['pending', 'expired'])));
      await this.plans.refreshWeekLoad(tx, cur.id);
      const xpEarned = await this.gamification.awardXp(tx, userId, 'checkin_submitted', XP_TABLE.checkin_submitted, { type: 'plan_week', id: cur.id });
      if (!next) return { proposalId: null, xp: xpEarned };
      await tx
        .update(learnPlanAdjustments)
        .set({ status: 'superseded' })
        .where(and(eq(learnPlanAdjustments.planId, tree.plan.id), eq(learnPlanAdjustments.planWeekId, next.id), eq(learnPlanAdjustments.source, 'checkin'), inArray(learnPlanAdjustments.status, ['pending', 'ready', 'needs_clarification', 'rejected', 'failed'])));
      const [row] = await tx
        .insert(learnPlanAdjustments)
        .values({ planId: tree.plan.id, planWeekId: next.id, userId, source: 'checkin', status: 'pending', input: stored, createdAt: this.now(), expiresAt: new Date(this.clock.now() + PROPOSAL_TTL_HOURS * 3_600_000) })
        .returning({ id: learnPlanAdjustments.id });
      return { proposalId: row!.id, xp: xpEarned };
    });
    let status: PlanAdjustProposal['status'] | null = proposalId ? 'pending' : null;
    if (proposalId) status = await this.dispatch(proposalId);
    const fresh = await this.plans.treeOf(tree.plan, tree.enrollment);
    const week = await this.weekView(fresh, cur.id, ctx);
    return { ...week, adjust: proposalId ? { proposal_id: proposalId, status: status! } : null, xp_earned: xp, difficulties_used: !!screened.text };
  }

  // ------------------------------------------------------------------ câu lệnh tự nhiên
  async instruct(userId: string, input: { program: ProgramCode; instruction: string }): Promise<PlanAdjustProposal> {
    await this.gate.check(userId, input.program, 'plan_adjust');
    const tree = await this.plans.currentTree(userId, input.program);
    if (!tree) throw new NotFound('study_plan', input.program);
    const cost = await this.gateway.estimateCredits('plan_adjust', input.program);
    if (cost > 0 && !(await this.credits.hasAtLeast(userId, cost))) throw new InsufficientCredits({ required: cost, balance: await this.credits.balance(userId) });
    const screened = await this.screen(userId, input.instruction, input.program);
    if (!screened.text) throw new ValidationFailed({ issues: [{ path: 'instruction', message: 'instruction refused by guard' }], refusal_code: screened.refusal });
    const ctx = await this.plans.userCtx(userId);
    const cur = tree.weeks[this.plans.weekIndexOf(tree, ctx.today)]!;
    const [row] = await this.dbs.db
      .insert(learnPlanAdjustments)
      .values({ planId: tree.plan.id, planWeekId: cur.id, userId, source: 'instruction', status: 'pending', input: { instruction: screened.text } satisfies StoredInput, createdAt: this.now(), expiresAt: new Date(this.clock.now() + PROPOSAL_TTL_HOURS * 3_600_000) })
      .returning();
    await this.dispatch(row!.id);
    return this.get(userId, row!.id);
  }

  /** Đặt job plan.adjust (jobId = proposal id); chạy inline (dev) thì chờ xong để trả trạng thái cuối */
  private async dispatch(proposalId: string): Promise<PlanAdjustProposal['status']> {
    const d = await this.jobs.dispatch('grading', JOB_NAMES.PLAN_ADJUST, proposalId, { proposal_id: proposalId });
    if (d.mode === 'inline' && d.done) await d.done.catch(() => undefined);
    const [r] = await this.dbs.db.select({ status: learnPlanAdjustments.status }).from(learnPlanAdjustments).where(eq(learnPlanAdjustments.id, proposalId));
    return (r?.status ?? 'pending') as PlanAdjustProposal['status'];
  }

  // ------------------------------------------------------------------ job
  /** Tuần được phép sửa của đề xuất: check-in → chỉ tuần tới; câu lệnh → tuần hiện tại (từ hôm nay) + tuần tới */
  private scopeWeeks(tree: PlanTree, row: AdjustmentRow): string[] {
    if (!row.planWeekId) return [];
    if (row.source === 'checkin') return [row.planWeekId];
    const i = tree.weeks.findIndex((w) => w.id === row.planWeekId);
    return [tree.weeks[i]?.id, tree.weeks[i + 1]?.id].filter((x): x is string => !!x);
  }

  private adjustWeeks(tree: PlanTree, weekIds: string[], row: AdjustmentRow): AdjustWeek[] {
    const input = row.input as StoredInput;
    return weekIds.map((id) => {
      const w = tree.weeks.find((x) => x.id === id)!;
      const meta = tree.strategy.weeks_meta?.find((m) => m.week_no === w.weekNo);
      const avail = row.source === 'checkin' ? (input.availability_next_week?.minutes ?? null) : null;
      return {
        id: w.id,
        start_date: w.startDate,
        end_date: meta?.end_date ?? addDays(w.startDate, 6),
        budget_minutes: meta?.budget_minutes ?? w.loadMinutes ?? 0,
        max_minutes: typeof avail === 'number' ? avail : null,
        study_dates: meta?.study_dates ?? [],
        is_final: w.weekNo === tree.weeks.length,
        tasks: tree.tasks.filter((t) => t.planWeekId === w.id).map((t) => ({ id: t.id, week_id: w.id, due_date: t.dueDate, task_type: t.taskType, est_minutes: t.estMinutes ?? 0, status: t.status, ref_type: t.refType ?? null, ref_id: t.refId ?? null })),
      };
    });
  }

  /** Áp dụng thử + kiểm tra nội dung có thật (catalog hiện tại) */
  private async evaluate(tree: PlanTree, row: AdjustmentRow, ops: PlanAdjustOutput['operations'], today: string) {
    const weekIds = this.scopeWeeks(tree, row);
    const ctx: AdjustContext = { today, examDate: tree.strategy.settings.exam_date, weeks: this.adjustWeeks(tree, weekIds, row) };
    const res = applyAdjustOps(ctx, ops);
    const index = inventoryIndex(toInventory(await this.catalog.planContent(tree.enrollment.programCode)));
    for (const w of res.weeks) for (const t of w.tasks) if (t.status !== 'skipped' && t.status !== 'expired' && !taskRefIsReal({ task_type: t.task_type, ref_type: t.ref_type as never, ref_id: t.ref_id }, index)) res.violations.push({ code: 'invalid_op', task_id: t.id, week_id: w.id, detail: 'unknown_ref' });
    return { ctx, res, weekIds };
  }

  private composeInstruction(row: AdjustmentRow, locale: string): string {
    const i = row.input as StoredInput;
    if (row.source === 'instruction') return i.instruction ?? '';
    const vi = locale === 'vi';
    const lines: string[] = [];
    if (typeof i.availability_next_week?.minutes === 'number') lines.push(vi ? `Tuần tới có thể học: ${i.availability_next_week.minutes} phút.` : `Available next week: ${i.availability_next_week.minutes} minutes.`);
    if (i.availability_next_week?.days?.length) lines.push(vi ? `Ngày rảnh tuần tới: ${i.availability_next_week.days.join(', ')}.` : `Free days next week: ${i.availability_next_week.days.join(', ')}.`);
    if (i.feeling) lines.push(vi ? `Cảm nhận tuần này: ${i.feeling}.` : `This week felt: ${i.feeling}.`);
    if (typeof i.actual_minutes === 'number') lines.push(vi ? `Đã học thực tế tuần này: ${i.actual_minutes} phút.` : `Actually studied this week: ${i.actual_minutes} minutes.`);
    if (i.difficulties) lines.push(vi ? `Khó khăn: ${i.difficulties}` : `Difficulties: ${i.difficulties}`);
    lines.push(vi ? 'Hãy điều chỉnh kế hoạch TUẦN TỚI cho phù hợp (nếu cần).' : 'Please adjust NEXT WEEK accordingly (if needed).');
    return lines.join('\n');
  }

  /** Bộ xử lý job plan.adjust */
  async run(proposalId: string): Promise<{ status: string }> {
    const [row] = await this.dbs.db.select().from(learnPlanAdjustments).where(eq(learnPlanAdjustments.id, proposalId));
    if (!row || row.status !== 'pending') return { status: row?.status ?? 'missing' };
    const [plan] = await this.dbs.db.select().from(learnStudyPlans).where(eq(learnStudyPlans.id, row.planId));
    const [enr] = plan ? await this.enrollments.byIds([plan.enrollmentId]) : [];
    if (!plan || !enr || !plan.isCurrent) return this.finish(row, 'superseded', null, null, null);
    const tree = await this.plans.treeOf(plan, { id: enr.id, userId: enr.userId, programCode: enr.programCode });
    const ctx = await this.plans.userCtx(row.userId);
    const user = await this.users.findById(row.userId);
    const settings = tree.strategy.settings;
    const weekIds = this.scopeWeeks(tree, row);
    const input = row.input as StoredInput;
    const ctxWeekId = row.source === 'checkin' ? (input.from_week_id ?? null) : weekIds[0];
    const brief = (t: TaskRow) => ({ id: t.id, date: t.dueDate, task_type: t.taskType, title: ((t.title as { vi?: string; en?: string } | null)?.[ctx.locale === 'vi' ? 'vi' : 'en']) ?? t.taskType, est_minutes: t.estMinutes ?? 0, status: t.status });
    const nextId = row.source === 'checkin' ? weekIds[0] : weekIds[1];
    const variables = {
      today: ctx.today,
      exam_date: settings.exam_date ?? 'none',
      daily_minutes: Math.round(settings.weekly_minutes / Math.max(1, settings.study_days.length)),
      rest_days: WEEKDAYS.filter((d) => !settings.study_days.includes(d)),
      tasks: ctxWeekId ? tree.tasks.filter((t) => t.planWeekId === ctxWeekId).map(brief) : [],
      next_week_tasks: nextId ? tree.tasks.filter((t) => t.planWeekId === nextId).map(brief) : [],
      instruction: stripPromptTags(this.composeInstruction(row, ctx.locale)),
      explain_locale: user?.explainLocale ?? 'vi',
    };
    let out: PlanAdjustOutput;
    let aiTaskId: string | null = null;
    try {
      const r = await this.gateway.runTask<PlanAdjustOutput>({ taskCode: 'plan_adjust', userId: row.userId, chargeCredits: row.source === 'instruction', variables, program: enr.programCode, locale: user?.explainLocale ?? 'vi', inputRef: { proposal_id: row.id, purpose: 'plan_adjust', source: row.source } });
      aiTaskId = r.aiTaskId;
      const parsed = planAdjustOutputSchema.safeParse(r.data);
      if (!parsed.success) return this.finish(row, 'failed', null, { error: 'invalid_output' }, aiTaskId);
      out = parsed.data;
    } catch (err) {
      this.logger.warn({ proposal_id: row.id, err: (err as Error).message.slice(0, 200) }, 'plan_adjust failed');
      return this.finish(row, 'failed', null, { error: (err as { reason?: string }).reason ?? 'ai_failed' }, aiTaskId);
    }
    if (out.needs_clarification) return this.finish(row, 'needs_clarification', out, null, aiTaskId);
    const { ctx: actx, res } = await this.evaluate(tree, row, out.operations, ctx.today);
    const before = tree.tasks.filter((t) => weekIds.includes(t.planWeekId)).map((t) => taskDto(t, ctx.today, ctx.locale));
    const afterById = new Map(res.weeks.flatMap((w) => w.tasks).map((t) => [t.id, t]));
    const after = before.map((t) => {
      const a = afterById.get(t.id);
      return a ? { ...t, due_date: a.due_date, est_minutes: a.est_minutes, status: a.status } : t;
    });
    const result: StoredResult = {
      scope_week_ids: weekIds,
      before,
      after,
      changes: res.changes,
      violations: res.violations,
      minutes_before: actx.weeks.reduce((a, w) => a + loadOf(w.tasks), 0),
      minutes_after: res.weeks.reduce((a, w) => a + loadOf(w.tasks), 0),
      budget_minutes: actx.weeks.reduce((a, w) => a + w.budget_minutes, 0),
      max_minutes: actx.weeks.reduce<number | null>((a, w) => (w.max_minutes === null ? a : (a ?? 0) + w.max_minutes), null),
      settings_patch: res.settings_patch,
    };
    return this.finish(row, res.violations.length ? 'rejected' : 'ready', out, result, aiTaskId);
  }

  private async finish(row: AdjustmentRow, status: PlanAdjustProposal['status'], proposal: PlanAdjustOutput | null, result: Partial<StoredResult> | null, aiTaskId: string | null): Promise<{ status: string }> {
    await this.dbs.db.transaction(async (tx) => {
      await tx.update(learnPlanAdjustments).set({ status, proposal, result, aiTaskId }).where(and(eq(learnPlanAdjustments.id, row.id), eq(learnPlanAdjustments.status, 'pending')));
      await this.outbox.write(tx, { aggregateType: 'plan_adjustment', aggregateId: row.id, eventType: DOMAIN_EVENTS.PLAN_ADJUST_PROPOSED, payload: { proposal_id: row.id, user_id: row.userId, status, source: row.source } });
    });
    this.outbox.emitLocal(DOMAIN_EVENTS.PLAN_ADJUST_PROPOSED, { proposal_id: row.id, user_id: row.userId, status, source: row.source });
    this.realtime.emitToUser(row.userId, 'plan.updated', { proposal_id: row.id, status, reason: 'proposal' });
    return { status };
  }

  // ------------------------------------------------------------------ đọc / áp dụng
  toDto(row: AdjustmentRow, weeks: Array<{ id: string; weekNo: number; startDate: string; endDate: string }>): PlanAdjustProposal {
    const r = (row.result ?? {}) as Partial<StoredResult>;
    const p = (row.proposal ?? null) as PlanAdjustOutput | null;
    const w = weeks.find((x) => x.id === row.planWeekId);
    return {
      proposal_id: row.id,
      status: row.status as PlanAdjustProposal['status'],
      source: row.source as 'checkin' | 'instruction',
      summary: p?.summary ?? null,
      clarifying_question: p?.clarifying_question ?? null,
      operations: (p?.operations ?? []),
      before: r.before ?? [],
      after: r.after ?? [],
      changes: r.changes ?? [],
      violations: (r.violations ?? []).map((v) => ({ ...v })),
      week: w ? { id: w.id, week_no: w.weekNo, start_date: w.startDate, end_date: w.endDate } : null,
      minutes_before: r.minutes_before ?? 0,
      minutes_after: r.minutes_after ?? 0,
      budget_minutes: r.budget_minutes ?? 0,
      max_minutes: r.max_minutes ?? null,
      created_at: row.createdAt.toISOString(),
      expires_at: row.expiresAt.toISOString(),
      applied_at: row.appliedAt ? row.appliedAt.toISOString() : null,
    };
  }

  private async weeksInfo(planIds: string[], db: DbOrTx = this.dbs.db) {
    if (!planIds.length) return [];
    const rows = await db.select({ w: learnPlanWeeks, strategy: learnStudyPlans.strategy }).from(learnPlanWeeks).innerJoin(learnStudyPlans, eq(learnStudyPlans.id, learnPlanWeeks.planId)).where(inArray(learnPlanWeeks.planId, planIds));
    return rows.map((r) => ({ id: r.w.id, weekNo: r.w.weekNo, startDate: r.w.startDate, endDate: (r.strategy as StoredStrategy).weeks_meta?.find((m) => m.week_no === r.w.weekNo)?.end_date ?? addDays(r.w.startDate, 6) }));
  }

  async get(userId: string, proposalId: string): Promise<PlanAdjustProposal> {
    const [row] = await this.dbs.db.select().from(learnPlanAdjustments).where(eq(learnPlanAdjustments.id, proposalId));
    if (!row) throw new NotFound('plan_adjustment', proposalId);
    if (row.userId !== userId) throw new Forbidden();
    return this.toDto(row, await this.weeksInfo([row.planId]));
  }

  /** GET /me/plan/adjust – lịch sử đề xuất của lộ trình hiện tại (mới nhất trước) */
  async list(userId: string, program: string, limit = 10): Promise<{ data: PlanAdjustProposal[] }> {
    const tree = await this.plans.currentTree(userId, program);
    if (!tree) return { data: [] };
    const rows = await this.dbs.db.select().from(learnPlanAdjustments).where(and(eq(learnPlanAdjustments.userId, userId), eq(learnPlanAdjustments.planId, tree.plan.id))).orderBy(desc(learnPlanAdjustments.createdAt)).limit(limit);
    const weeks = await this.weeksInfo([tree.plan.id]);
    return { data: rows.map((r) => this.toDto(r, weeks)) };
  }

  private async weekView(tree: PlanTree, weekId: string, ctx: { today: string; locale: string }): Promise<PlanWeek> {
    const dto = await this.plans.toDto(tree, ctx);
    return dto.weeks.find((w) => w.id === weekId) ?? weekDto(tree.weeks.find((w) => w.id === weekId)!, tree.tasks.filter((t) => t.planWeekId === weekId), undefined, { ...ctx, locked: false, focusSection: null, focusSkill: null });
  }

  /** POST /me/plan/adjust/{proposalId}/apply – một transaction; ràng buộc kiểm lại trên dữ liệu mới nhất (409 nếu không còn hợp lệ) */
  async apply(userId: string, proposalId: string): Promise<{ proposal: PlanAdjustProposal; week: PlanWeek }> {
    const ctx = await this.plans.userCtx(userId);
    const applied = await this.dbs.db.transaction(async (tx) => {
      const [row] = await tx.select().from(learnPlanAdjustments).where(eq(learnPlanAdjustments.id, proposalId)).for('update');
      if (!row) throw new NotFound('plan_adjustment', proposalId);
      if (row.userId !== userId) throw new Forbidden();
      if (row.status === 'applied') return { row, already: true };
      if (row.status !== 'ready') throw new Conflict('Proposal cannot be applied', { status: row.status, violations: ((row.result ?? {}) as Partial<StoredResult>).violations ?? [] });
      if (row.expiresAt.getTime() < this.clock.now()) {
        await tx.update(learnPlanAdjustments).set({ status: 'expired' }).where(eq(learnPlanAdjustments.id, row.id));
        throw new Conflict('Proposal has expired', { status: 'expired' });
      }
      const [plan] = await tx.select().from(learnStudyPlans).where(eq(learnStudyPlans.id, row.planId)).for('update');
      if (!plan?.isCurrent) throw new Conflict('Study plan has changed', { status: 'superseded' });
      const [enr] = await this.enrollments.byIds([plan.enrollmentId]);
      const tree = await this.plans.treeOf(plan, { id: enr!.id, userId: enr!.userId, programCode: enr!.programCode }, tx);
      const ops = ((row.proposal ?? {}) as PlanAdjustOutput).operations ?? [];
      const { res, weekIds } = await this.evaluate(tree, row, ops, ctx.today);
      if (res.violations.length) throw new Conflict('Proposal is no longer valid', { violations: res.violations });
      for (const t of res.weeks.flatMap((w) => w.tasks)) {
        const orig = tree.tasks.find((x) => x.id === t.id)!;
        if (orig.dueDate === t.due_date && (orig.estMinutes ?? 0) === t.est_minutes && orig.status === t.status) continue;
        await tx.update(learnPlanTasks).set({ dueDate: t.due_date, estMinutes: t.est_minutes, status: t.status }).where(eq(learnPlanTasks.id, t.id));
      }
      const input = row.input as StoredInput;
      const summary = ((row.proposal ?? {}) as PlanAdjustOutput).summary ?? null;
      for (const wid of weekIds) {
        const changes = res.changes.filter((c) => res.weeks.find((w) => w.id === wid)?.tasks.some((t) => t.id === c.task_id));
        await tx
          .update(learnPlanWeeks)
          .set({ adjustment: { proposal_id: row.id, source: row.source, reason: summary, evidence: { feeling: input.feeling ?? null, actual_minutes: input.actual_minutes ?? null, availability_minutes: input.availability_next_week?.minutes ?? null }, changes, applied_at: this.now().toISOString() } })
          .where(eq(learnPlanWeeks.id, wid));
        await this.plans.refreshWeekLoad(tx, wid);
      }
      if (res.settings_patch?.reminder_time) await tx.execute(sql`update learn.study_plans set strategy = jsonb_set(strategy, '{settings,reminder_time}', to_jsonb(${res.settings_patch.reminder_time}::text)) where id = ${plan.id}::uuid`);
      const [updated] = await tx.update(learnPlanAdjustments).set({ status: 'applied', appliedAt: this.now() }).where(eq(learnPlanAdjustments.id, row.id)).returning();
      await this.outbox.write(tx, { aggregateType: 'plan_adjustment', aggregateId: row.id, eventType: DOMAIN_EVENTS.PLAN_ADJUSTED, payload: { proposal_id: row.id, user_id: userId, plan_id: plan.id, changes: res.changes.length } });
      return { row: updated!, already: false };
    });
    if (!applied.already) this.realtime.emitToUser(userId, 'plan.updated', { proposal_id: proposalId, reason: 'adjusted' });
    const [plan] = await this.dbs.db.select().from(learnStudyPlans).where(eq(learnStudyPlans.id, applied.row.planId));
    const [enr] = await this.enrollments.byIds([plan!.enrollmentId]);
    const tree = await this.plans.treeOf(plan!, { id: enr!.id, userId: enr!.userId, programCode: enr!.programCode });
    return { proposal: this.toDto(applied.row, await this.weeksInfo([plan!.id])), week: await this.weekView(tree, applied.row.planWeekId!, ctx) };
  }
}
