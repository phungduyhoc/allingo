import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { BETA_TESTER_ROLE, DOMAIN_EVENTS, isStaffRoles, NPS_SCHEDULE, type BetaSurveyInput, type SurveyKind } from '@allingo/schemas';
import type { AuthUser } from '../../../shared/auth/auth.guard.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { Conflict, NotFound } from '../../../shared/http/errors.js';
import { GROWTH_METRICS } from '../../../shared/telemetry/metrics.js';
import { UsersService } from '../../iam/index.js';
import { BetaService } from '../beta/beta.service.js';

const { opsSurveyResponses } = schema;
const DAY = 86_400_000;

export interface PendingSurvey {
  kind: SurveyKind;
  due_at: string;
  expires_at: string | null;
}

/**
 * Khảo sát NPS ngày 7 và 14 (thuần): mốc = ngày đổi mã beta (tester được cấp vai trò không qua mã: ngày đăng ký). nps_d7 hiển thị
 * [7, 14), nps_d14 [14, 28); đã trả lời → không hiển thị. Onboarding beta: tester chưa trả lời.
 * B6/S146: chỉ beta tester nhận khảo sát; tài khoản nhân sự (`STAFF_ROLES` – admin, editor, teacher…) không nhận dù có vai trò tester.
 */
export function pendingSurveys(input: { base: Date; now: Date; answered: ReadonlySet<SurveyKind>; betaTester: boolean; staff?: boolean }): PendingSurvey[] {
  const out: PendingSurvey[] = [];
  if (!input.betaTester || input.staff) return out;
  if (!input.answered.has('beta_onboarding')) out.push({ kind: 'beta_onboarding', due_at: input.base.toISOString(), expires_at: null });
  const days = (input.now.getTime() - input.base.getTime()) / DAY;
  for (const kind of ['nps_d7', 'nps_d14'] as const) {
    const s = NPS_SCHEDULE[kind];
    if (input.answered.has(kind) || days < s.day || days >= s.until_day) continue;
    out.push({ kind, due_at: new Date(input.base.getTime() + s.day * DAY).toISOString(), expires_at: new Date(input.base.getTime() + s.until_day * DAY).toISOString() });
  }
  return out;
}

/** Khảo sát onboarding beta (5 câu, JSONB) + NPS in-app (S12) – ops.survey_responses, một lần mỗi loại */
@Injectable()
export class SurveysService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly beta: BetaService,
    private readonly outbox: OutboxService,
  ) {}

  private async answered(userId: string): Promise<Map<SurveyKind, typeof opsSurveyResponses.$inferSelect>> {
    const rows = await this.dbs.db.select().from(opsSurveyResponses).where(eq(opsSurveyResponses.userId, userId));
    return new Map(rows.map((r) => [r.kind as SurveyKind, r]));
  }

  private toDto(r: typeof opsSurveyResponses.$inferSelect) {
    return { kind: r.kind as SurveyKind, submitted_at: r.createdAt.toISOString(), score: r.score ?? null };
  }

  async submitBetaSurvey(user: AuthUser, input: BetaSurveyInput) {
    const [row] = await this.dbs.db
      .insert(opsSurveyResponses)
      .values({ userId: user.id, kind: 'beta_onboarding', answers: input })
      .onConflictDoUpdate({ target: [opsSurveyResponses.userId, opsSurveyResponses.kind], set: { answers: input } })
      .returning();
    await this.outbox.write(this.dbs.db, { aggregateType: 'survey', aggregateId: row!.id, eventType: DOMAIN_EVENTS.SURVEY_SUBMITTED, payload: { user_id: user.id, kind: 'beta_onboarding', goal: input.goal, has_exam_date: !!input.exam_date, devices: input.devices, study_minutes_per_day: input.study_minutes_per_day } });
    GROWTH_METRICS.feedback.inc({ kind: 'survey_beta_onboarding' });
    return this.toDto(row!);
  }

  async pending(user: AuthUser, now: Date = new Date(this.clock.now())): Promise<{ data: PendingSurvey[] }> {
    const u = await this.users.findById(user.id);
    if (!u) throw new NotFound('user', user.id);
    const redeemedAt = await this.beta.redeemedAt(user.id);
    // Vai trò trong DB (JWT có thể chưa làm mới sau khi đổi mã/cấp vai trò) ∪ vai trò trong token
    const roles = new Set([...user.roles, ...(await this.users.getRoles(user.id))]);
    const tester = !!redeemedAt || roles.has(BETA_TESTER_ROLE);
    const staff = isStaffRoles([...roles]);
    if (!tester || staff) return { data: [] };
    const answered = await this.answered(user.id);
    return { data: pendingSurveys({ base: redeemedAt ?? u.createdAt, now, answered: new Set(answered.keys()), betaTester: tester, staff }) };
  }

  async submitNps(user: AuthUser, input: { score: number; comment?: string; survey?: 'nps_d7' | 'nps_d14' }) {
    const now = new Date(this.clock.now());
    const answered = await this.answered(user.id);
    if (input.survey && answered.has(input.survey)) return this.toDto(answered.get(input.survey)!);
    const pending = (await this.pending(user, now)).data.filter((p) => p.kind !== 'beta_onboarding');
    const kind = input.survey ?? pending[0]?.kind;
    if (!kind || !pending.some((p) => p.kind === kind)) {
      // Không có NPS đang chờ: đã trả lời gần nhất → trả lại (idempotent), còn lại 409 not_due
      const done = (['nps_d14', 'nps_d7'] as const).find((k) => answered.has(k));
      if (!input.survey && done) return this.toDto(answered.get(done)!);
      throw new Conflict('No NPS survey is due', { reason: 'not_due' });
    }
    const [row] = await this.dbs.db.insert(opsSurveyResponses).values({ userId: user.id, kind, score: input.score, comment: input.comment?.trim() || null }).onConflictDoNothing().returning();
    if (!row) {
      const [existing] = await this.dbs.db.select().from(opsSurveyResponses).where(and(eq(opsSurveyResponses.userId, user.id), eq(opsSurveyResponses.kind, kind))).limit(1);
      return this.toDto(existing!);
    }
    await this.outbox.write(this.dbs.db, { aggregateType: 'survey', aggregateId: row.id, eventType: DOMAIN_EVENTS.SURVEY_SUBMITTED, payload: { user_id: user.id, kind, score: input.score, has_comment: !!input.comment } });
    GROWTH_METRICS.feedback.inc({ kind: `survey_${kind}` });
    return this.toDto(row);
  }
}
