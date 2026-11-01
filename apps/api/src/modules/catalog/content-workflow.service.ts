import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import {
  CONTENT_STATUSES,
  DOMAIN_EVENTS,
  DEFAULT_DUPLICATE_THRESHOLD,
  REVIEW_DECISIONS,
  REVIEW_STAGES,
  contentRoleOf,
  evaluateTransition,
  findBatchDuplicates,
  isDbReviewDecision,
  programCodeSchema,
  questionContentSchema,
  questionTypeCodeSchema,
  targetOf,
  type AiCheckReport,
  type ContentStatus,
  type QuestionContent,
  type ReviewDecision,
  type ReviewStage,
} from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { AppError, Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { UsersService } from '../iam/index.js';

const { catalogQuestions, catalogQuestionVersions, catalogSections, catalogTopics, catalogSubskills, catalogQuestionSubskills, catalogContentReviews, catalogPassages } = schema;
type QuestionRow = typeof catalogQuestions.$inferSelect;
type VersionRow = typeof catalogQuestionVersions.$inferSelect;

/** Metadata vòng đời lưu trên question_versions.metadata (DDL không có cột riêng – A24) */
interface VersionMeta {
  external_ref?: string | null;
  source?: string;
  created_by_email?: string | null;
  content_updated_at?: string;
  published_at?: string | null;
  /** Trạng thái duyệt của bản sửa đang chờ (khi câu đã phát hành có phiên bản mới chưa duyệt) */
  workflow_status?: ContentStatus;
  [k: string]: unknown;
}

const reviewSchema = z.object({
  stage: z.enum(REVIEW_STAGES),
  decision: z.enum(REVIEW_DECISIONS),
  notes: z.string().max(2000).nullish(),
  reviewer_email: z.string().max(254).nullish(),
  ai_report: z.record(z.string(), z.unknown()).nullish(),
});

/** CMS → catalog: đồng bộ mỗi lần lưu/chuyển trạng thái (ADR-0024). Idempotent theo external_ref. */
export const syncQuestionSchema = z.object({
  external_ref: z.string().min(1).max(128),
  program: programCodeSchema,
  section_code: z.string().min(1).max(32),
  question_type: questionTypeCodeSchema,
  content: questionContentSchema,
  status: z.enum(CONTENT_STATUSES).default('published'),
  difficulty: z.string().max(10).optional(),
  topic_code: z.string().max(64).optional(),
  subskill_codes: z.array(z.string().max(64)).max(10).optional(),
  source: z.enum(['human', 'ai', 'licensed']).default('human'),
  change_note: z.string().max(500).optional(),
  created_by_email: z.string().max(254).optional(),
  review: reviewSchema.nullish(),
});
export type SyncQuestionInput = z.infer<typeof syncQuestionSchema>;

export const adminQuestionInputSchema = z.object({
  program: programCodeSchema,
  section_code: z.string().min(1).max(32),
  question_type: questionTypeCodeSchema,
  passage_id: z.uuid().optional(),
  topic_code: z.string().max(64).optional(),
  subskill_codes: z.array(z.string().max(64)).max(10).optional(),
  difficulty_target: z.string().max(10).optional(),
  source: z.enum(['human', 'ai', 'licensed']).default('human'),
  content: questionContentSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AdminQuestionInput = z.infer<typeof adminQuestionInputSchema>;

export const newVersionInputSchema = z.object({ content: questionContentSchema, metadata: z.record(z.string(), z.unknown()).optional(), change_note: z.string().max(500).optional() });
export type NewVersionInput = z.infer<typeof newVersionInputSchema>;

export const reviewInputSchema = z.object({ stage: z.enum(REVIEW_STAGES), decision: z.enum(REVIEW_DECISIONS), notes: z.string().max(2000).optional() });
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export interface Actor {
  id: string;
  roles: string[];
}

export interface AdminQuestionDto {
  id: string;
  program: string;
  section_code: string;
  question_type: string;
  status: ContentStatus;
  /** Trạng thái duyệt của bản đang soạn (khác `status` khi câu đã phát hành có bản sửa chờ duyệt) */
  workflow_status: ContentStatus;
  has_pending_version: boolean;
  head_version: { id: string; version_no: number; content: QuestionContent; change_note: string | null; created_at: string };
  current_version_id: string | null;
  external_ref: string | null;
  source: string;
  difficulty_target: string | null;
  updated_at: string;
}

/** JSON chuẩn hoá (sắp khoá) – jsonb của PostgreSQL đổi thứ tự khoá nên không so sánh JSON.stringify trực tiếp */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Vòng đời nội dung câu hỏi trong catalog (nguồn sự thật – ADR-0024).
 * - `questions.status` là trạng thái người học nhìn thấy (published/retired) hoặc trạng thái duyệt của câu chưa từng phát hành.
 * - Bản sửa của câu đã phát hành là phiên bản mới (head) chưa gán `current_version_id`; trạng thái duyệt của nó lưu ở
 *   `metadata.workflow_status`; khi duyệt vòng 2 xong mới chuyển `current_version_id` (attempt cũ vẫn trỏ bản cũ – §5.9).
 * - Quyết định approve/reject/needs_change ghi `catalog.content_reviews`; submit/retire/reopen ghi `ops.audit_logs`.
 */
@Injectable()
export class ContentWorkflowService {
  constructor(
    private readonly dbs: DbService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  // ------------------------------------------------------------------ đọc
  private async headVersion(questionId: string, db: DbOrTx): Promise<VersionRow> {
    const [v] = await db.select().from(catalogQuestionVersions).where(eq(catalogQuestionVersions.questionId, questionId)).orderBy(desc(catalogQuestionVersions.versionNo)).limit(1);
    if (!v) throw new NotFound('question_version', questionId);
    return v;
  }

  /** Trạng thái chủ thể duyệt: bản sửa chờ duyệt (nếu có) hoặc chính câu hỏi */
  private subjectStatus(q: QuestionRow, head: VersionRow): { status: ContentStatus; pending: boolean } {
    const pending = !!q.currentVersionId && head.id !== q.currentVersionId && (q.status === 'published' || q.status === 'retired');
    if (pending) return { status: (head.metadata as VersionMeta).workflow_status ?? 'draft', pending: true };
    return { status: q.status, pending: false };
  }

  private async loadQuestion(questionId: string, db: DbOrTx): Promise<QuestionRow> {
    const [q] = await db.select().from(catalogQuestions).where(eq(catalogQuestions.id, questionId)).limit(1);
    if (!q) throw new NotFound('question', questionId);
    return q;
  }

  async toDto(q: QuestionRow, head: VersionRow, db: DbOrTx = this.dbs.db): Promise<AdminQuestionDto> {
    const [s] = await db.select({ code: catalogSections.code }).from(catalogSections).where(eq(catalogSections.id, q.sectionId)).limit(1);
    const subj = this.subjectStatus(q, head);
    const meta = head.metadata as VersionMeta;
    return {
      id: q.id,
      program: q.programCode,
      section_code: s?.code ?? '',
      question_type: q.questionTypeCode,
      status: q.status,
      workflow_status: subj.status,
      has_pending_version: subj.pending,
      head_version: { id: head.id, version_no: head.versionNo, content: head.content, change_note: head.changeNote ?? null, created_at: head.createdAt.toISOString() },
      current_version_id: q.currentVersionId ?? null,
      external_ref: meta.external_ref ?? null,
      source: q.source,
      difficulty_target: q.difficultyTarget ?? null,
      updated_at: q.updatedAt.toISOString(),
    };
  }

  async get(questionId: string): Promise<AdminQuestionDto> {
    const q = await this.loadQuestion(questionId, this.dbs.db);
    return this.toDto(q, await this.headVersion(questionId, this.dbs.db));
  }

  async list(filter: { program?: string; status?: string; section?: string; q?: string; cursor?: string; limit: number }): Promise<{ data: AdminQuestionDto[]; next_cursor: string | null }> {
    const conds: SQL[] = [];
    if (filter.program) conds.push(eq(catalogQuestions.programCode, filter.program));
    if (filter.status) conds.push(eq(catalogQuestions.status, filter.status as ContentStatus));
    if (filter.section) conds.push(sql`${catalogQuestions.sectionId} in (select id from catalog.sections where code = ${filter.section})`);
    if (filter.q) conds.push(sql`exists (select 1 from catalog.question_versions v where v.question_id = ${catalogQuestions.id} and (v.content ->> 'stem') ilike ${`%${filter.q}%`})`);
    const cur = filter.cursor ? decodeCursor<{ u: string; id: string }>(filter.cursor) : null;
    if (cur) conds.push(sql`(${catalogQuestions.updatedAt}, ${catalogQuestions.id}) < (${cur.u}::timestamptz, ${cur.id}::uuid)`);
    const rows = await this.dbs.db
      .select()
      .from(catalogQuestions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(catalogQuestions.updatedAt), desc(catalogQuestions.id))
      .limit(filter.limit + 1);
    const page = rows.slice(0, filter.limit);
    const data = await Promise.all(page.map(async (q) => this.toDto(q, await this.headVersion(q.id, this.dbs.db))));
    const last = page[page.length - 1];
    return { data, next_cursor: rows.length > filter.limit && last ? encodeCursor({ u: last.updatedAt.toISOString(), id: last.id }) : null };
  }

  async versions(questionId: string) {
    await this.loadQuestion(questionId, this.dbs.db);
    const rows = await this.dbs.db.select().from(catalogQuestionVersions).where(eq(catalogQuestionVersions.questionId, questionId)).orderBy(desc(catalogQuestionVersions.versionNo));
    return rows.map((v) => {
      const m = v.metadata as VersionMeta;
      return { id: v.id, version_no: v.versionNo, content: v.content, change_note: v.changeNote ?? null, published_at: m.published_at ?? null, workflow_status: m.workflow_status ?? null, created_at: v.createdAt.toISOString() };
    });
  }

  async reviews(entityType: string, entityId: string) {
    const rows = await this.dbs.db.select().from(catalogContentReviews).where(and(eq(catalogContentReviews.entityType, entityType), eq(catalogContentReviews.entityId, entityId))).orderBy(desc(catalogContentReviews.createdAt));
    return rows.map((r) => ({ id: r.id, stage: r.stage, decision: r.decision, reviewer_id: r.reviewerId ?? null, notes: r.notes ?? null, ai_report: (r.aiReport as Record<string, unknown> | null) ?? null, created_at: r.createdAt.toISOString() }));
  }

  // ------------------------------------------------------------------ tạo / sửa
  private async resolveRefs(db: DbOrTx, program: string, sectionCode: string, topicCode?: string) {
    const [section] = await db.select({ id: catalogSections.id }).from(catalogSections).where(and(eq(catalogSections.programCode, program), eq(catalogSections.code, sectionCode))).limit(1);
    if (!section) throw new ValidationFailed({ issues: [{ path: 'section_code', message: `section ${sectionCode} not found in ${program}` }] });
    const topic = topicCode ? (await db.select({ id: catalogTopics.id }).from(catalogTopics).where(eq(catalogTopics.code, topicCode)).limit(1))[0] : undefined;
    return { sectionId: section.id, topicId: topic?.id ?? null };
  }

  private async setSubskills(db: DbOrTx, questionId: string, program: string, codes?: string[]) {
    if (!codes) return;
    await db.delete(catalogQuestionSubskills).where(eq(catalogQuestionSubskills.questionId, questionId));
    if (!codes.length) return;
    const subs = await db.select({ id: catalogSubskills.id }).from(catalogSubskills).where(and(eq(catalogSubskills.programCode, program), inArray(catalogSubskills.code, codes)));
    for (const s of subs) await db.insert(catalogQuestionSubskills).values({ questionId, subskillId: s.id, weight: '1' }).onConflictDoNothing();
  }

  /** POST /admin/questions – câu mới ở trạng thái draft, phiên bản 1 */
  async create(actor: Actor, input: AdminQuestionInput): Promise<AdminQuestionDto> {
    this.requireRole(actor);
    if (input.content.type !== input.question_type) throw new ValidationFailed({ issues: [{ path: 'content.type', message: 'content.type must match question_type' }] });
    return this.dbs.db.transaction(async (tx) => {
      const { sectionId, topicId } = await this.resolveRefs(tx, input.program, input.section_code, input.topic_code);
      if (input.passage_id) {
        const [p] = await tx.select({ id: catalogPassages.id }).from(catalogPassages).where(eq(catalogPassages.id, input.passage_id)).limit(1);
        if (!p) throw new NotFound('passage', input.passage_id);
      }
      const [q] = await tx
        .insert(catalogQuestions)
        .values({ programCode: input.program, sectionId, questionTypeCode: input.question_type, passageId: input.passage_id ?? null, topicId, status: 'draft', source: input.source, difficultyTarget: (input.difficulty_target as never) ?? null, createdBy: actor.id })
        .returning();
      const meta: VersionMeta = { ...(input.metadata ?? {}), source: 'api', content_updated_at: new Date().toISOString(), published_at: null };
      const [v] = await tx.insert(catalogQuestionVersions).values({ questionId: q!.id, versionNo: 1, content: input.content, metadata: meta, createdBy: actor.id }).returning();
      await tx.update(catalogQuestions).set({ currentVersionId: v!.id }).where(eq(catalogQuestions.id, q!.id));
      await this.setSubskills(tx, q!.id, input.program, input.subskill_codes);
      await this.audit.log({ action: 'content.created', actorUserId: actor.id, entityType: 'question', entityId: q!.id }, tx);
      return this.toDto({ ...q!, currentVersionId: v!.id }, v!, tx);
    });
  }

  /**
   * POST /admin/questions/{id}/versions – bản nội dung mới.
   * Câu chưa từng phát hành: ghi đè bản head (chưa ai làm) và quay về draft. Câu đã phát hành: tạo phiên bản mới chờ duyệt
   * (người học vẫn thấy bản cũ). Đã có bản chờ duyệt: ghi đè bản chờ và quay về draft.
   */
  async newVersion(actor: Actor, questionId: string, input: NewVersionInput): Promise<AdminQuestionDto> {
    const role = this.requireRole(actor);
    return this.dbs.db.transaction(async (tx) => {
      const q = await this.loadQuestion(questionId, tx);
      if (input.content.type !== q.questionTypeCode) throw new ValidationFailed({ issues: [{ path: 'content.type', message: 'content.type must match question type' }] });
      const head = await this.headVersion(questionId, tx);
      const subj = this.subjectStatus(q, head);
      if (role === 'editor' && !['draft', 'ai_checked', 'rejected', 'published'].includes(subj.status)) {
        throw new Forbidden('Editors cannot change content under review', { status: subj.status });
      }
      const now = new Date().toISOString();
      const headPublished = !!(head.metadata as VersionMeta).published_at;
      let version: VersionRow;
      if (headPublished) {
        const meta: VersionMeta = { ...(head.metadata as VersionMeta), ...(input.metadata ?? {}), content_updated_at: now, published_at: null, workflow_status: 'draft' };
        [version] = (await tx.insert(catalogQuestionVersions).values({ questionId, versionNo: head.versionNo + 1, content: input.content, metadata: meta, changeNote: input.change_note ?? null, createdBy: actor.id }).returning()) as [VersionRow];
      } else {
        const meta: VersionMeta = { ...(head.metadata as VersionMeta), ...(input.metadata ?? {}), content_updated_at: now, workflow_status: subj.pending ? 'draft' : undefined };
        [version] = (await tx.update(catalogQuestionVersions).set({ content: input.content, metadata: meta, changeNote: input.change_note ?? head.changeNote }).where(eq(catalogQuestionVersions.id, head.id)).returning()) as [VersionRow];
      }
      // Câu chưa phát hành: nội dung đổi → quay về draft
      const nextStatus: ContentStatus = q.status === 'published' || q.status === 'retired' ? (q.status) : 'draft';
      const [updated] = await tx.update(catalogQuestions).set({ status: nextStatus, currentVersionId: q.status === 'published' || q.status === 'retired' ? q.currentVersionId : version.id, updatedAt: new Date() }).where(eq(catalogQuestions.id, questionId)).returning();
      await this.audit.log({ action: 'content.version_created', actorUserId: actor.id, entityType: 'question', entityId: questionId, after: { version_no: version.versionNo } }, tx);
      return this.toDto(updated!, version, tx);
    });
  }

  // ------------------------------------------------------------------ duyệt
  private requireRole(actor: Actor) {
    const role = contentRoleOf(actor.roles);
    if (!role) throw new Forbidden('Content role required', { required: ['editor', 'teacher', 'admin'] });
    return role;
  }

  /** Báo cáo AI gần nhất cho nội dung hiện tại (sau lần sửa nội dung cuối) */
  private async latestAiReport(db: DbOrTx, questionId: string, head: VersionRow): Promise<AiCheckReport | null> {
    const since = (head.metadata as VersionMeta).content_updated_at ?? head.createdAt.toISOString();
    const [r] = await db
      .select()
      .from(catalogContentReviews)
      .where(and(eq(catalogContentReviews.entityType, 'question'), eq(catalogContentReviews.entityId, questionId), eq(catalogContentReviews.stage, 'ai_check'), gte(catalogContentReviews.createdAt, new Date(since))))
      .orderBy(desc(catalogContentReviews.createdAt))
      .limit(1);
    if (!r) return null;
    const report = (r.aiReport as AiCheckReport | null) ?? {};
    return { ...report, verdict: report.verdict ?? (r.decision === 'approve' ? 'pass' : r.decision === 'reject' ? 'fail' : 'needs_change') };
  }

  private async review1Approver(db: DbOrTx, questionId: string): Promise<string | null> {
    const [r] = await db
      .select({ reviewerId: catalogContentReviews.reviewerId })
      .from(catalogContentReviews)
      .where(and(eq(catalogContentReviews.entityType, 'question'), eq(catalogContentReviews.entityId, questionId), eq(catalogContentReviews.stage, 'review1'), eq(catalogContentReviews.decision, 'approve')))
      .orderBy(desc(catalogContentReviews.createdAt))
      .limit(1);
    return r?.reviewerId ?? null;
  }

  /**
   * POST /admin/content/{entityType}/{entityId}/review – quyết định → chuyển trạng thái theo máy trạng thái dùng chung.
   * `ai_check` chỉ đặt bởi hệ thống (runAiCheck); con người gửi stage=ai_check bị từ chối (ai_check_only).
   */
  async review(actor: Actor, entityType: string, entityId: string, input: ReviewInput & { aiReport?: AiCheckReport | null; viaAiCheck?: boolean }, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    if (entityType !== 'question') throw new AppError('feature_disabled', `Review for ${entityType} is not available yet`, 501, { entity_type: entityType });
    const role = this.requireRole(actor);
    return this.dbs.db.transaction(async (tx) => {
      const q = await this.loadQuestion(entityId, tx);
      const head = await this.headVersion(entityId, tx);
      const subj = this.subjectStatus(q, head);
      let to: ContentStatus | null;
      if (input.stage === 'ai_check' && input.viaAiCheck === true) {
        // Kết quả AI: pass/needs_change → ai_checked (từ draft); fail → giữ nguyên trạng thái, ghi review reject để chặn gửi duyệt
        if (subj.status !== 'draft' && subj.status !== 'ai_checked') throw new AppError('conflict', `AI check is only available in draft/ai_checked (current: ${subj.status})`, 409, { status: subj.status });
        to = input.decision === 'reject' ? subj.status : 'ai_checked';
      } else {
        to = targetOf(subj.status, input.stage, input.decision);
      }
      if (!to) throw new AppError('conflict', `Decision ${input.stage}/${input.decision} is not valid from status ${subj.status}`, 409, { status: subj.status, stage: input.stage, decision: input.decision });
      const aiReport = input.aiReport ?? (await this.latestAiReport(tx, entityId, head));
      const result = evaluateTransition({ from: subj.status, to, role, aiReport, note: input.notes ?? null, viaAiCheck: input.viaAiCheck === true, actorId: actor.id, review1ApproverId: await this.review1Approver(tx, entityId) });
      if (!result.ok) {
        const forbidden = result.code === 'role_not_allowed' || result.code === 'four_eyes';
        throw new AppError(forbidden ? 'forbidden' : 'conflict', result.message, forbidden ? 403 : 409, { reason: result.code, status: subj.status });
      }

      const nextStatus = to;
      await this.applyStatus(tx, q, head, subj.pending, nextStatus, actor.id);
      await this.recordDecision(tx, entityId, head.versionNo, { stage: input.stage, decision: input.decision, notes: input.notes ?? null, reviewerId: input.viaAiCheck ? null : actor.id, aiReport: aiReport && input.stage === 'ai_check' ? aiReport : null }, { actorId: actor.id, ip: meta.ip, userAgent: meta.userAgent, from: subj.status, to: nextStatus });
      const fresh = await this.loadQuestion(entityId, tx);
      return this.toDto(fresh, await this.headVersion(entityId, tx), tx);
    });
  }

  /** Áp trạng thái mới cho câu/bản sửa; phát hành → chuyển current_version_id + outbox */
  private async applyStatus(tx: DbOrTx, q: QuestionRow, head: VersionRow, pending: boolean, to: ContentStatus, actorId: string | null) {
    const now = new Date();
    const meta = head.metadata as VersionMeta;
    if (to === 'published') {
      await tx.update(catalogQuestionVersions).set({ metadata: { ...meta, published_at: now.toISOString(), workflow_status: 'published' } }).where(eq(catalogQuestionVersions.id, head.id));
      await tx.update(catalogQuestions).set({ status: 'published', currentVersionId: head.id, retiredAt: null, updatedAt: now }).where(eq(catalogQuestions.id, q.id));
      await this.outbox.write(tx, { aggregateType: 'question', aggregateId: q.id, eventType: DOMAIN_EVENTS.CONTENT_PUBLISHED, payload: { entity: 'question', question_id: q.id, question_version_id: head.id, version_no: head.versionNo, program: q.programCode, actor_id: actorId } });
      return;
    }
    if (to === 'retired') {
      await tx.update(catalogQuestions).set({ status: 'retired', retiredAt: now, updatedAt: now }).where(eq(catalogQuestions.id, q.id));
      await this.outbox.write(tx, { aggregateType: 'question', aggregateId: q.id, eventType: DOMAIN_EVENTS.CONTENT_RETIRED, payload: { entity: 'question', question_id: q.id, program: q.programCode } });
      return;
    }
    if (pending) {
      await tx.update(catalogQuestionVersions).set({ metadata: { ...meta, workflow_status: to } }).where(eq(catalogQuestionVersions.id, head.id));
      await tx.update(catalogQuestions).set({ updatedAt: now }).where(eq(catalogQuestions.id, q.id));
    } else {
      await tx.update(catalogQuestions).set({ status: to, updatedAt: now }).where(eq(catalogQuestions.id, q.id));
    }
  }

  private async recordDecision(
    tx: DbOrTx,
    questionId: string,
    versionNo: number,
    d: { stage: ReviewStage; decision: ReviewDecision; notes: string | null; reviewerId: string | null; aiReport: AiCheckReport | null },
    meta: { actorId: string | null; ip?: string | null; userAgent?: string | null; from: ContentStatus; to: ContentStatus },
  ) {
    if (isDbReviewDecision(d.decision)) {
      await tx.insert(catalogContentReviews).values({ entityType: 'question', entityId: questionId, stage: d.stage, reviewerId: d.reviewerId, decision: d.decision, notes: d.notes, aiReport: d.aiReport ? { ...d.aiReport, version_no: versionNo } : { version_no: versionNo } });
    }
    await this.audit.log({ action: `content.${d.stage}.${d.decision}`, actorUserId: meta.actorId, entityType: 'question', entityId: questionId, before: { status: meta.from }, after: { status: meta.to, version_no: versionNo }, ip: meta.ip, userAgent: meta.userAgent }, tx);
  }

  // ------------------------------------------------------------------ đồng bộ từ CMS
  /**
   * CMS → catalog (mỗi lần lưu/chuyển trạng thái). Trạng thái do CMS đã kiểm tra bằng cùng máy trạng thái; API ghi lại
   * nguyên trạng, tạo phiên bản khi nội dung của câu đã phát hành thay đổi, ghi content_reviews theo `review`.
   */
  async syncFromCms(input: SyncQuestionInput): Promise<{ question_id: string; question_version_id: string; version_no: number; status: ContentStatus; changed: boolean }> {
    if (input.content.type !== input.question_type) throw new ValidationFailed({ issues: [{ path: 'content.type', message: 'content.type must match question_type' }] });
    const reviewer = input.review?.reviewer_email ? await this.users.findByEmail(input.review.reviewer_email) : null;
    const creator = input.created_by_email ? await this.users.findByEmail(input.created_by_email) : null;
    return this.dbs.db.transaction(async (tx) => {
      const { sectionId, topicId } = await this.resolveRefs(tx, input.program, input.section_code, input.topic_code);
      const now = new Date().toISOString();
      const [existing] = await tx
        .select({ questionId: catalogQuestionVersions.questionId })
        .from(catalogQuestionVersions)
        .where(sql`${catalogQuestionVersions.metadata} ->> 'external_ref' = ${input.external_ref}`)
        .limit(1);

      let q: QuestionRow;
      let head: VersionRow;
      let changed = false;
      if (!existing) {
        [q] = (await tx
          .insert(catalogQuestions)
          .values({ programCode: input.program, sectionId, questionTypeCode: input.question_type, topicId, status: 'draft', source: input.source, difficultyTarget: (input.difficulty as never) ?? null, createdBy: creator?.id ?? null })
          .returning()) as [QuestionRow];
        const meta: VersionMeta = { external_ref: input.external_ref, source: 'cms', created_by_email: input.created_by_email ?? null, content_updated_at: now, published_at: null };
        [head] = (await tx.insert(catalogQuestionVersions).values({ questionId: q.id, versionNo: 1, content: input.content, metadata: meta, changeNote: input.change_note ?? null, createdBy: creator?.id ?? null }).returning()) as [VersionRow];
        [q] = (await tx.update(catalogQuestions).set({ currentVersionId: head.id }).where(eq(catalogQuestions.id, q.id)).returning()) as [QuestionRow];
        changed = true;
      } else {
        q = await this.loadQuestion(existing.questionId, tx);
        head = await this.headVersion(q.id, tx);
        const headMeta = head.metadata as VersionMeta;
        if (!sameJson(head.content, input.content)) {
          changed = true;
          if (headMeta.published_at) {
            const meta: VersionMeta = { external_ref: input.external_ref, source: 'cms', created_by_email: input.created_by_email ?? null, content_updated_at: now, published_at: null, workflow_status: input.status === 'published' ? 'published' : input.status };
            [head] = (await tx.insert(catalogQuestionVersions).values({ questionId: q.id, versionNo: head.versionNo + 1, content: input.content, metadata: meta, changeNote: input.change_note ?? null, createdBy: creator?.id ?? null }).returning()) as [VersionRow];
          } else {
            [head] = (await tx.update(catalogQuestionVersions).set({ content: input.content, metadata: { ...headMeta, content_updated_at: now }, changeNote: input.change_note ?? head.changeNote }).where(eq(catalogQuestionVersions.id, head.id)).returning()) as [VersionRow];
          }
        }
        await tx.update(catalogQuestions).set({ sectionId, questionTypeCode: input.question_type, topicId, difficultyTarget: (input.difficulty as never) ?? null }).where(eq(catalogQuestions.id, q.id));
      }
      await this.setSubskills(tx, q.id, input.program, input.subskill_codes);

      const subj = this.subjectStatus(q, head);
      const wasLive = subj.status === 'published' && !subj.pending && !changed;
      if (input.status !== subj.status || (input.status === 'published' && !(head.metadata as VersionMeta).published_at)) {
        if (!(input.status === 'published' && wasLive)) await this.applyStatus(tx, q, head, subj.pending, input.status, reviewer?.id ?? creator?.id ?? null);
      }
      if (input.review) {
        await this.recordDecision(
          tx,
          q.id,
          head.versionNo,
          { stage: input.review.stage, decision: input.review.decision, notes: input.review.notes ?? null, reviewerId: input.review.stage === 'ai_check' ? null : (reviewer?.id ?? null), aiReport: (input.review.ai_report) ?? null },
          { actorId: reviewer?.id ?? null, from: subj.status, to: input.status },
        );
      }
      return { question_id: q.id, question_version_id: head.id, version_no: head.versionNo, status: input.status, changed };
    });
  }

  // ------------------------------------------------------------------ trùng lặp (nhập hàng loạt)
  /**
   * Phát hiện câu trùng: trong lô (trigram JS) và với câu đã có trong catalog cùng chương trình (pg_trgm similarity ≥ ngưỡng,
   * so với bản head). Embedding dedup ở Sprint 5.
   */
  async findDuplicates(program: string, stems: string[], threshold = DEFAULT_DUPLICATE_THRESHOLD, excludeExternalRefs: string[] = []) {
    const inBatch = findBatchDuplicates(stems, threshold);
    const batchDup = new Set(inBatch.map((d) => d.index));
    const existing: Array<{ index: number; question_id: string; similarity: number; status: string }> = [];
    for (let i = 0; i < stems.length; i++) {
      if (batchDup.has(i) || !stems[i]?.trim()) continue;
      const rows = await this.dbs.db.execute<{ question_id: string; sim: number; status: string }>(sql`
        select v.question_id, similarity(v.content ->> 'stem', ${stems[i]}) as sim, q.status
        from catalog.question_versions v
        join catalog.questions q on q.id = v.question_id
        where q.program_code = ${program}
          and q.status <> 'rejected'
          and v.version_no = (select max(v2.version_no) from catalog.question_versions v2 where v2.question_id = v.question_id)
          ${excludeExternalRefs.length ? sql`and coalesce(v.metadata ->> 'external_ref', '') not in (${sql.join(excludeExternalRefs.map((r) => sql`${r}`), sql`, `)})` : sql``}
          and (v.content ->> 'stem') % ${stems[i]}
          and similarity(v.content ->> 'stem', ${stems[i]}) >= ${threshold}
        order by sim desc
        limit 1`);
      const r = rows[0];
      if (r) existing.push({ index: i, question_id: r.question_id, similarity: Math.round(Number(r.sim) * 1000) / 1000, status: r.status });
    }
    return { threshold, in_batch: inBatch, existing };
  }
}
