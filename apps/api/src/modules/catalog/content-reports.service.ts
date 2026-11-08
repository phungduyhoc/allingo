import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { CONTENT_REPORT_SLA_HOURS, DOMAIN_EVENTS, type ContentReportItem } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { NotFound } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { UsersService } from '../iam/index.js';

const { opsContentReports, catalogQuestionVersions } = schema;
const ENTITY = 'question_version';

type ReportRow = typeof opsContentReports.$inferSelect;

/**
 * Báo lỗi câu hỏi (S12): người học báo theo `question_version_id` → ops.content_reports (SLA 48 giờ) → hàng đợi duyệt CMS
 * (collection `content-reports` đồng bộ qua /internal/content-reports) + admin API. Xử lý (confirmed/rejected/fixed) → outbox
 * `content_report.resolved` (growth gửi in-app cảm ơn người báo). Số báo lỗi theo câu dùng cho thống kê câu (retire/review).
 */
@Injectable()
export class ContentReportsService {
  private readonly logger = getLogger({ component: 'catalog.content_reports' });

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly users: UsersService,
  ) {}

  async create(userId: string, input: { question_version_id: string; reason: string; message?: string }) {
    const [qv] = await this.dbs.db.select({ id: catalogQuestionVersions.id, questionId: catalogQuestionVersions.questionId }).from(catalogQuestionVersions).where(eq(catalogQuestionVersions.id, input.question_version_id)).limit(1);
    if (!qv) throw new NotFound('question_version', input.question_version_id);
    const now = new Date(this.clock.now());
    const due = new Date(now.getTime() + CONTENT_REPORT_SLA_HOURS * 3_600_000);
    const out = await this.dbs.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(opsContentReports)
        .values({ userId, entityType: ENTITY, entityId: qv.id, reason: input.reason, message: input.message?.trim() || null, status: 'open', slaDueAt: due, createdAt: now })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        const [existing] = await tx.select().from(opsContentReports).where(and(eq(opsContentReports.userId, userId), eq(opsContentReports.entityType, ENTITY), eq(opsContentReports.entityId, qv.id), eq(opsContentReports.status, 'open'))).limit(1);
        return { row: existing!, duplicate: true };
      }
      await this.outbox.write(tx, { aggregateType: 'content_report', aggregateId: row.id, eventType: DOMAIN_EVENTS.CONTENT_REPORT_CREATED, payload: { report_id: row.id, user_id: userId, question_id: qv.questionId, question_version_id: qv.id, reason: input.reason } });
      return { row, duplicate: false };
    });
    if (!out.duplicate) this.outbox.emitLocal(DOMAIN_EVENTS.CONTENT_REPORT_CREATED, { report_id: out.row.id, user_id: userId, question_id: qv.questionId, reason: input.reason });
    return { id: out.row.id, status: out.row.status as ContentReportItem['status'], sla_due_at: (out.row.slaDueAt ?? due).toISOString(), duplicate: out.duplicate, created_at: out.row.createdAt.toISOString() };
  }

  /** Danh sách (admin/CMS): lọc trạng thái, quá hạn, câu; `updated_since` cho đồng bộ CMS (tăng dần theo updated_at) */
  async list(q: { status?: string; overdue?: boolean; question_id?: string; updated_since?: string; cursor?: string; limit: number }): Promise<{ data: ContentReportItem[]; next_cursor: string | null }> {
    const now = new Date(this.clock.now());
    const conds: SQL[] = [eq(opsContentReports.entityType, ENTITY)];
    if (q.status) conds.push(eq(opsContentReports.status, q.status));
    if (q.overdue === true) conds.push(sql`${opsContentReports.status} = 'open' and ${opsContentReports.slaDueAt} < ${now.toISOString()}::timestamptz`);
    if (q.question_id) conds.push(sql`exists (select 1 from catalog.question_versions v where v.id = ${opsContentReports.entityId} and v.question_id = ${q.question_id})`);
    const sync = !!q.updated_since;
    const c = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (sync) {
      const since = c ? new Date(c.at) : new Date(q.updated_since!);
      conds.push(c ? or(gt(opsContentReports.updatedAt, since), and(eq(opsContentReports.updatedAt, since), gt(opsContentReports.id, c.id)))! : gt(opsContentReports.updatedAt, new Date(since.getTime() - 1)));
    } else if (c) conds.push(or(lt(opsContentReports.createdAt, new Date(c.at)), and(eq(opsContentReports.createdAt, new Date(c.at)), lt(opsContentReports.id, c.id)))!);
    const rows = await this.dbs.db
      .select()
      .from(opsContentReports)
      .where(and(...conds))
      .orderBy(...(sync ? [asc(opsContentReports.updatedAt), asc(opsContentReports.id)] : [desc(opsContentReports.createdAt), desc(opsContentReports.id)]))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const data = await this.enrich(page, now);
    const last = page[page.length - 1];
    const next = rows.length > q.limit && last ? encodeCursor({ at: (sync ? last.updatedAt : last.createdAt).toISOString(), id: last.id }) : null;
    return { data, next_cursor: next };
  }

  async get(id: string): Promise<ContentReportItem> {
    const [row] = await this.dbs.db.select().from(opsContentReports).where(eq(opsContentReports.id, id)).limit(1);
    if (!row) throw new NotFound('content_report', id);
    return (await this.enrich([row], new Date(this.clock.now())))[0]!;
  }

  private async enrich(rows: ReportRow[], now: Date): Promise<ContentReportItem[]> {
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((r) => r.entityId))];
    const meta = (await this.dbs.db.execute(sql`
      select v.id, v.question_id, v.version_no, v.metadata->>'external_ref' as external_ref, s.code as section_code,
             left(coalesce(v.content->>'stem', v.content->'stem'->>'text', v.content->>'prompt', ''), 160) as stem,
             (select count(*)::int from ops.content_reports r join catalog.question_versions v2 on v2.id = r.entity_id
               where r.entity_type = ${ENTITY} and v2.question_id = v.question_id) as reports
      from catalog.question_versions v join catalog.questions q on q.id = v.question_id left join catalog.sections s on s.id = q.section_id
      where v.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)) as unknown as Array<{ id: string; question_id: string; version_no: number; external_ref: string | null; section_code: string | null; stem: string | null; reports: number }>;
    const by = new Map(meta.map((m) => [m.id, m]));
    return rows.map((r) => {
      const m = by.get(r.entityId);
      return {
        id: r.id,
        question_id: m?.question_id ?? null,
        question_version_id: r.entityId,
        version_no: m?.version_no ?? null,
        external_ref: m?.external_ref ?? null,
        section_code: m?.section_code ?? null,
        stem_preview: m?.stem || null,
        reason: r.reason,
        message: r.message ?? null,
        status: r.status as ContentReportItem['status'],
        resolution_note: r.resolutionNote ?? null,
        sla_due_at: r.slaDueAt?.toISOString() ?? null,
        overdue: r.status === 'open' && !!r.slaDueAt && r.slaDueAt < now,
        reports_for_question: m?.reports ?? 0,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
        resolved_at: r.resolvedAt?.toISOString() ?? null,
      };
    });
  }

  /** Xử lý báo cáo (admin API hoặc CMS qua API nội bộ – `resolved_by_email` của biên tập viên) */
  async setStatus(id: string, input: { status: string; resolution_note?: string; resolved_by_email?: string }, actor: { id: string | null; roles: string[]; via: 'admin' | 'cms' }): Promise<ContentReportItem> {
    const now = new Date(this.clock.now());
    let resolver = actor.id;
    if (!resolver && input.resolved_by_email) resolver = (await this.users.findByEmail(input.resolved_by_email))?.id ?? null;
    const ev = await this.dbs.db.transaction(async (tx) => {
      const [before] = await tx.select().from(opsContentReports).where(eq(opsContentReports.id, id)).for('update').limit(1);
      if (!before) throw new NotFound('content_report', id);
      const closing = input.status !== 'open';
      await tx
        .update(opsContentReports)
        .set({ status: input.status, resolutionNote: input.resolution_note ?? before.resolutionNote, resolvedBy: closing ? resolver : null, resolvedAt: closing ? (before.resolvedAt ?? now) : null })
        .where(eq(opsContentReports.id, id));
      await this.audit.log({ action: 'content_report.update', actorUserId: resolver, actorRole: actor.roles.join(',') || actor.via, entityType: 'content_report', entityId: id, before: { status: before.status }, after: { status: input.status, via: actor.via } }, tx);
      if (closing && before.status !== input.status && before.userId) {
        const payload = { report_id: id, user_id: before.userId, status: input.status, question_version_id: before.entityId, dedupe_key: `content_report:${id}:${input.status}` };
        await this.outbox.write(tx, { aggregateType: 'content_report', aggregateId: id, eventType: DOMAIN_EVENTS.CONTENT_REPORT_RESOLVED, payload });
        return payload;
      }
      return null;
    });
    if (ev) this.outbox.emitLocal(DOMAIN_EVENTS.CONTENT_REPORT_RESOLVED, ev);
    this.logger.info({ report_id: id, status: input.status, via: actor.via }, 'content report updated');
    return this.get(id);
  }

  /** Số báo lỗi theo câu (thống kê nightly): mở / xác nhận / tổng */
  async countsByQuestion(): Promise<Map<string, { open: number; confirmed: number; total: number }>> {
    const rows = (await this.dbs.db.execute(sql`
      select v.question_id, count(*) filter (where r.status = 'open')::int as open,
             count(*) filter (where r.status in ('confirmed','fixed'))::int as confirmed, count(*)::int as total
      from ops.content_reports r join catalog.question_versions v on v.id = r.entity_id
      where r.entity_type = ${ENTITY} group by v.question_id`)) as unknown as Array<{ question_id: string; open: number; confirmed: number; total: number }>;
    return new Map(rows.map((r) => [r.question_id, { open: r.open, confirmed: r.confirmed, total: r.total }]));
  }

  /** SLA 48 giờ: số báo cáo mở quá hạn */
  async overdueCount(now: Date = new Date(this.clock.now())): Promise<number> {
    const [r] = (await this.dbs.db.execute(sql`select count(*)::int as n from ops.content_reports where status = 'open' and sla_due_at < ${now.toISOString()}::timestamptz`)) as unknown as Array<{ n: number }>;
    return r?.n ?? 0;
  }
}
