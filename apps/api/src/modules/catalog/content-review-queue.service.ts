import { Injectable } from '@nestjs/common';
import { and, eq, inArray, param, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import {
  CONTENT_ROLES,
  REVIEW_QUEUE_STATUSES,
  contentRoleOf,
  runAutoChecks,
  type AutoCheckResult,
  type ContentStatus,
  type ReviewBulkAction,
  type ReviewBulkInput,
  type ReviewQueueQuery,
  type ReviewStage,
} from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { AppError, Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { maskEmail, UsersService } from '../iam/index.js';
import { CatalogQueryService } from './catalog-query.service.js';
import { ContentDedupService, type DuplicateFlag } from './content-dedup.service.js';
import { ContentWorkflowService, type Actor } from './content-workflow.service.js';

const { catalogQuestions } = schema;

type QueueRow = Record<string, unknown> & {
  id: string;
  program: string;
  section_code: string;
  section_rules: Record<string, unknown> | null;
  question_type: string;
  status: ContentStatus;
  workflow_status: ContentStatus;
  source: string;
  difficulty: string | null;
  passage_id: string | null;
  passage_title: string | null;
  passage_kind: string | null;
  passage_body: string | null;
  passage_media: string | null;
  created_by: string | null;
  review_assignee_id: string | null;
  review_assigned_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  head_id: string;
  version_no: number;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  has_pending: boolean;
  sim: number | null;
};

const iso = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const STAGE_OF: Partial<Record<ContentStatus, ReviewStage>> = { review1: 'review1', review2: 'review2' };

/**
 * B2 – hàng chờ duyệt nội dung (catalog là nguồn sự thật – ADR-0024): lọc theo chương trình/Part/nguồn/cờ trùng/người tạo/reviewer/
 * ngày/đề nháp, sắp xếp theo ngày tạo/cập nhật/độ giống; mỗi câu kèm nội dung bản đang soạn, passage + part, kết quả AI check gần nhất,
 * kiểm tra tự động (runAutoChecks), cờ nghi trùng + câu tương tự. Duyệt/từ chối hàng loạt đi qua máy trạng thái dùng chung
 * (ContentWorkflowService.review – từng câu một transaction, ghi content_reviews + audit); phân công reviewer ghi cột
 * questions.review_assignee_id + audit.
 */
@Injectable()
export class ContentReviewQueueService {
  constructor(
    private readonly dbs: DbService,
    private readonly workflow: ContentWorkflowService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogQueryService,
    private readonly dedup: ContentDedupService,
  ) {}

  private requireStaff(actor: Actor) {
    const role = contentRoleOf(actor.roles);
    if (!role) throw new Forbidden('Content role required', { required: [...CONTENT_ROLES] });
    return role;
  }

  async list(actor: Actor, q: ReviewQueueQuery) {
    this.requireStaff(actor);
    const conds: SQL[] = [];
    if (q.program) conds.push(sql`b.program = ${q.program}`);
    if (q.section) conds.push(sql`b.section_code = ${q.section}`);
    conds.push(q.status ? sql`b.workflow_status = ${q.status}` : sql`b.workflow_status = any(${param([...REVIEW_QUEUE_STATUSES])}::text[])`);
    if (q.source) conds.push(sql`b.source = ${q.source}`);
    if (q.duplicate === true) conds.push(sql`coalesce((b.metadata -> 'duplicate' ->> 'flagged')::boolean, false)`);
    if (q.duplicate === false) conds.push(sql`not coalesce((b.metadata -> 'duplicate' ->> 'flagged')::boolean, false)`);
    if (q.created_by) conds.push(sql`b.created_by = ${q.created_by === 'me' ? actor.id : q.created_by}::uuid`);
    if (q.assignee === 'none') conds.push(sql`b.review_assignee_id is null`);
    else if (q.assignee) conds.push(sql`b.review_assignee_id = ${q.assignee === 'me' ? actor.id : q.assignee}::uuid`);
    if (q.test_set_id) conds.push(sql`exists (select 1 from catalog.test_set_items i where i.test_set_id = ${q.test_set_id}::uuid and i.question_id = b.id)`);
    if (q.from) conds.push(sql`(b.created_at at time zone 'Asia/Ho_Chi_Minh')::date >= ${q.from}::date`);
    if (q.to) conds.push(sql`(b.created_at at time zone 'Asia/Ho_Chi_Minh')::date <= ${q.to}::date`);
    if (q.q) conds.push(sql`(b.content ->> 'stem') ilike ${`%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);

    const key = q.sort === 'updated_at' ? sql`b.updated_at` : q.sort === 'similarity' ? sql`coalesce(b.sim, -1)` : sql`b.created_at`;
    const desc = q.order === 'desc';
    const cur = decodeCursor<{ k: string | number; id: string }>(q.cursor);
    if (cur) {
      const kv = q.sort === 'similarity' ? sql`${Number(cur.k)}::float8` : sql`${String(cur.k)}::timestamptz`;
      conds.push(desc ? sql`(${key}, b.id) < (${kv}, ${cur.id}::uuid)` : sql`(${key}, b.id) > (${kv}, ${cur.id}::uuid)`);
    }
    const rows = [
      ...(await this.dbs.db.execute<QueueRow>(sql`
      with b as (
        select q.id, q.program_code as program, s.code as section_code, s.rules as section_rules, q.question_type_code as question_type,
               q.status, q.source::text as source, q.difficulty_target::text as difficulty, q.passage_id,
               p.title as passage_title, p.kind::text as passage_kind, p.body as passage_body, p.media_asset_id as passage_media,
               q.created_by, q.review_assignee_id, q.review_assigned_at, q.created_at, q.updated_at,
               h.id as head_id, h.version_no, h.content, h.metadata,
               (q.current_version_id is not null and h.id <> q.current_version_id and q.status in ('published', 'retired')) as has_pending,
               case when q.current_version_id is not null and h.id <> q.current_version_id and q.status in ('published', 'retired')
                    then coalesce(h.metadata ->> 'workflow_status', 'draft') else q.status::text end as workflow_status,
               case when (h.metadata -> 'duplicate' ->> 'similarity') ~ '^[0-9.]+$' then (h.metadata -> 'duplicate' ->> 'similarity')::float8 end as sim
          from catalog.questions q
          join catalog.sections s on s.id = q.section_id
          join lateral (select v.id, v.version_no, v.content, v.metadata from catalog.question_versions v where v.question_id = q.id order by v.version_no desc limit 1) h on true
          left join catalog.passages p on p.id = q.passage_id
         where q.status in ('draft', 'ai_checked', 'review1', 'review2', 'published', 'retired', 'rejected')
      )
      select * from b
       where ${and(...conds)}
       order by ${key} ${desc ? sql`desc` : sql`asc`}, b.id ${desc ? sql`desc` : sql`asc`}
       limit ${q.limit + 1}`)),
    ];
    const page = rows.slice(0, q.limit);
    const data = await this.decorate(page);
    const last = page[page.length - 1];
    const nextKey = last ? (q.sort === 'similarity' ? (last.sim ?? -1) : iso(q.sort === 'updated_at' ? last.updated_at : last.created_at)) : null;
    const counts = await this.counts(q.program);
    return { data, next_cursor: rows.length > q.limit && last ? encodeCursor({ k: nextKey, id: last.id }) : null, counts };
  }

  /** Số câu theo trạng thái chờ (badge tab) */
  private async counts(program?: string): Promise<Record<string, number>> {
    const rows = await this.dbs.db.execute<{ status: string; n: number }>(sql`
      select q.status::text as status, count(*)::int as n from catalog.questions q
       where q.status in ('draft', 'ai_checked', 'review1', 'review2') ${program ? sql`and q.program_code = ${program}` : sql``}
       group by q.status`);
    return Object.fromEntries([...rows].map((r) => [r.status, Number(r.n)]));
  }

  private async decorate(page: QueueRow[]) {
    const ids = page.map((r) => r.id);
    const ai = new Map<string, { verdict: string | null; issues: unknown[]; checked_at: string }>();
    if (ids.length) {
      const reviews = await this.dbs.db.execute<{ entity_id: string; decision: string; ai_report: Record<string, unknown> | null; created_at: Date | string }>(sql`
        select distinct on (entity_id) entity_id, decision::text as decision, ai_report, created_at
          from catalog.content_reviews
         where entity_type = 'question' and stage = 'ai_check' and entity_id = any(${param(ids)}::uuid[])
         order by entity_id, created_at desc`);
      for (const r of reviews) {
        const rep = (r.ai_report ?? {}) as { verdict?: string; issues?: unknown[] };
        ai.set(r.entity_id, { verdict: rep.verdict ?? (r.decision === 'approve' ? 'pass' : r.decision === 'reject' ? 'fail' : 'needs_change'), issues: Array.isArray(rep.issues) ? rep.issues.slice(0, 10) : [], checked_at: iso(r.created_at)! });
      }
    }
    const people = await this.users.staffProfiles(page.flatMap((r) => [r.created_by, r.review_assignee_id].filter((x): x is string => !!x)));
    const person = (id: string | null) => {
      const p = id ? people.get(id) : undefined;
      return p ? { id: p.id, display_name: p.display_name, email: p.email ? maskEmail(p.email) : null } : null;
    };
    const parts = await this.catalog.passageParts(page.map((r) => r.passage_id).filter((x): x is string => !!x));
    // Đề bài rút gọn của câu bị nghi trùng (để reviewer so sánh ngay)
    const dupIds = new Set<string>();
    for (const r of page) {
      const d = r.metadata.duplicate as Partial<DuplicateFlag> | undefined;
      if (d?.of_question_id) dupIds.add(d.of_question_id);
      for (const x of d?.similar ?? []) dupIds.add(x.question_id);
    }
    const stems = await this.stemPreviews([...dupIds]);
    return page.map((r) => {
      const dup = (r.metadata.duplicate as (Partial<DuplicateFlag> & { of_index?: number | null }) | undefined) ?? null;
      const checks: AutoCheckResult[] = runAutoChecks({ program: r.program, section_code: r.section_code, question_type: r.question_type, content: r.content, has_passage: !!r.passage_id, passage_has_audio: !!r.passage_media, section_rules: r.section_rules });
      const meta = r.metadata as { external_ref?: string | null; generation?: { job_id?: string } };
      return {
        id: r.id,
        question_version_id: r.head_id,
        version_no: r.version_no,
        program: r.program,
        section_code: r.section_code,
        question_type: r.question_type,
        status: r.status,
        workflow_status: r.workflow_status,
        has_pending_version: r.has_pending,
        source: r.source,
        difficulty: r.difficulty,
        external_ref: meta.external_ref ?? null,
        content: r.content,
        passage: r.passage_id ? { id: r.passage_id, kind: r.passage_kind ?? 'reading_passage', title: r.passage_title, body: r.passage_body, parts: (parts.get(r.passage_id) ?? []).map((p) => ({ id: p.id, sort_order: p.sort_order, title: p.title, body: p.body })) } : null,
        created_by: person(r.created_by),
        assignee: person(r.review_assignee_id),
        assigned_at: iso(r.review_assigned_at),
        created_at: iso(r.created_at)!,
        updated_at: iso(r.updated_at)!,
        ai_check: ai.get(r.id) ?? null,
        auto_checks: checks,
        duplicate: dup
          ? {
              flagged: dup.flagged === true,
              method: dup.method ?? null,
              similarity: dup.similarity ?? null,
              of_question_id: dup.of_question_id ?? null,
              of_stem: dup.of_question_id ? (stems.get(dup.of_question_id) ?? null) : null,
              checked_at: dup.checked_at ?? null,
              similar: (dup.similar ?? []).map((s) => ({ ...s, stem: stems.get(s.question_id) ?? null })),
            }
          : null,
      };
    });
  }

  private async stemPreviews(questionIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!questionIds.length) return out;
    const rows = await this.dbs.db.execute<{ id: string; stem: string | null }>(sql`
      select q.id, (select v.content ->> 'stem' from catalog.question_versions v where v.question_id = q.id order by v.version_no desc limit 1) as stem
        from catalog.questions q where q.id = any(${param(questionIds)}::uuid[])`);
    for (const r of rows) out.set(r.id, (r.stem ?? '').slice(0, 240));
    return out;
  }

  /** Câu tương tự theo yêu cầu (nút "Tìm câu giống" trong khung xem trước) – chạy lại dedup cho bản head */
  async similar(actor: Actor, questionId: string) {
    this.requireStaff(actor);
    const [q] = await this.dbs.db.select({ id: catalogQuestions.id }).from(catalogQuestions).where(eq(catalogQuestions.id, questionId)).limit(1);
    if (!q) throw new NotFound('question', questionId);
    const [head] = [...(await this.dbs.db.execute<{ id: string }>(sql`select v.id from catalog.question_versions v where v.question_id = ${questionId}::uuid order by v.version_no desc limit 1`))];
    const flags = await this.dedup.checkVersions([head!.id]);
    const flag = flags.get(head!.id) ?? null;
    const stems = await this.stemPreviews((flag?.similar ?? []).map((s) => s.question_id));
    return { question_id: questionId, question_version_id: head!.id, duplicate: flag ? { ...flag, similar: flag.similar.map((s) => ({ ...s, stem: stems.get(s.question_id) ?? null })) } : null };
  }

  /** Quyết định cho một câu từ hành động hàng loạt (stage theo trạng thái hiện tại) */
  private decisionFor(action: ReviewBulkAction, status: ContentStatus): { stage: ReviewStage; decision: 'approve' | 'reject' | 'needs_change' | 'submit' } | null {
    if (action === 'submit') return status === 'draft' || status === 'ai_checked' ? { stage: 'review1', decision: 'submit' } : null;
    const stage = STAGE_OF[status];
    return stage ? { stage, decision: action } : null;
  }

  async bulk(actor: Actor, input: ReviewBulkInput, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    const role = this.requireStaff(actor);
    const ids = [...new Set(input.question_ids)];
    const results: Array<{ question_id: string; ok: boolean; status: string | null; error: { code: string; message: string; reason?: string } | null }> = [];
    for (const id of ids) {
      try {
        const cur = await this.workflow.get(id);
        const d = this.decisionFor(input.action, cur.workflow_status);
        if (!d) throw new AppError('conflict', `Action ${input.action} is not valid from status ${cur.workflow_status}`, 409, { reason: 'invalid_transition', status: cur.workflow_status });
        const dto = await this.workflow.review(actor, 'question', id, { stage: d.stage, decision: d.decision, notes: input.notes }, meta);
        results.push({ question_id: id, ok: true, status: dto.workflow_status, error: null });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined;
        results.push({ question_id: id, ok: false, status: null, error: { code: err.code, message: err.message.slice(0, 200), ...(reason ? { reason } : {}) } });
      }
    }
    const ok = results.filter((r) => r.ok).length;
    await this.audit.log({ action: 'content.bulk_review', actorUserId: actor.id, actorRole: role, entityType: 'question', after: { action: input.action, requested: ids.length, ok, failed: ids.length - ok }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    return { action: input.action, requested: ids.length, ok, failed: ids.length - ok, results };
  }

  /** Phân công reviewer: teacher/admin; người được giao phải có vai trò duyệt (teacher/admin) */
  async assign(actor: Actor, questionIds: string[], assigneeId: string | null, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    const role = this.requireStaff(actor);
    if (role === 'editor') throw new Forbidden('Only teacher/admin can assign reviewers', { required: ['teacher', 'admin'] });
    if (assigneeId) {
      const assigneeRole = contentRoleOf(await this.users.getRoles(assigneeId));
      if (assigneeRole !== 'teacher' && assigneeRole !== 'admin') throw new ValidationFailed({ issues: [{ path: 'assignee_id', message: 'assignee must have a reviewer role (teacher/admin)' }] });
    }
    const ids = [...new Set(questionIds)];
    const updated = await this.dbs.db.transaction(async (tx) => {
      const rows = await tx
        .update(catalogQuestions)
        .set({ reviewAssigneeId: assigneeId, reviewAssignedAt: assigneeId ? new Date() : null })
        .where(inArray(catalogQuestions.id, ids))
        .returning({ id: catalogQuestions.id });
      for (const r of rows) await this.audit.log({ action: 'content.review_assigned', actorUserId: actor.id, actorRole: role, entityType: 'question', entityId: r.id, after: { assignee_id: assigneeId }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
      return rows.length;
    });
    return { updated, assignee_id: assigneeId, missing: ids.length - updated };
  }

  /** Reviewer có thể phân công (teacher/admin đang hoạt động) + editor (lọc "người tạo") */
  async reviewers(actor: Actor) {
    this.requireStaff(actor);
    const ids = await this.users.idsWithRoles(['editor', 'teacher', 'admin', 'superadmin']);
    const people = await this.users.staffProfiles(ids);
    return {
      data: [...people.values()]
        .map((p) => ({ id: p.id, display_name: p.display_name, email: p.email ? maskEmail(p.email) : null, role: contentRoleOf(p.roles) ?? 'admin', can_review: ['teacher', 'admin'].includes(contentRoleOf(p.roles) ?? '') }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'vi')),
    };
  }

}
