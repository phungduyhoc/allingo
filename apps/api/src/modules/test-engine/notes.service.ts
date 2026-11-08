import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { NOTE_BODY_MAX, sanitizeNoteMarkdown, type Note } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { CatalogQueryService } from '../catalog/index.js';
import { AttemptInsightsService } from './attempt-insights.service.js';

const { learnNotes } = schema;
type NoteRow = typeof learnNotes.$inferSelect;
interface NoteData {
  question_version_id?: string | null;
  attempt_id?: string | null;
  created_at?: string;
}

export interface NoteRefs {
  question_version_id?: string;
  attempt_id?: string;
  question_id?: string;
  test_set_id?: string;
}

/** Thoát ký tự đặc biệt của LIKE */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Ghi chú người học (learn.notes kind `user`, S6): gắn câu (question_id + data.question_version_id) và/hoặc attempt
 * (data.attempt_id), đề (test_set_id). Markdown ngắn đã làm sạch ≤ 2.000 ký tự; tìm kiếm ILIKE + pg_trgm word_similarity;
 * cursor (updated_at, id). Thẻ tóm tắt hệ thống (kind system_summary – S5) không đi qua đây.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly dbs: DbService,
    private readonly catalog: CatalogQueryService,
    private readonly insights: AttemptInsightsService,
  ) {}

  toDto(r: NoteRow): Note {
    const d = (r.data as NoteData | null) ?? {};
    const base = { id: r.id, body: r.body, question_id: r.questionId ?? null, question_version_id: d.question_version_id ?? null, attempt_id: d.attempt_id ?? null, test_set_id: r.testSetId ?? null, created_at: d.created_at ?? null, updated_at: r.updatedAt.toISOString() };
    if (r.kind !== 'system_summary') return base;
    // S12: tóm tắt tuần/tiến bộ AI cho dashboard (không lộ ai_task_id/prompt_version_id)
    const sd = (r.data ?? {}) as { summary?: Record<string, unknown>; attempt_ids?: string[] };
    return { ...base, kind: 'system_summary', summary: sd.summary ?? null, attempt_ids: sd.attempt_ids ?? [] };
  }

  private cleanBody(raw: string): string {
    const body = sanitizeNoteMarkdown(raw);
    if (!body) throw new ValidationFailed({ issues: [{ path: 'body', message: 'body is empty after sanitizing' }] });
    if (body.length > NOTE_BODY_MAX) throw new ValidationFailed({ issues: [{ path: 'body', message: `body must be ≤ ${NOTE_BODY_MAX} characters`, max: NOTE_BODY_MAX }] });
    return body;
  }

  /** Chuẩn hoá tham chiếu: question_version_id → question_id; attempt thuộc người dùng; câu thuộc attempt; test_set của attempt */
  private async resolveRefs(userId: string, refs: NoteRefs): Promise<{ questionId: string | null; testSetId: string | null; data: NoteData }> {
    let questionId = refs.question_id ?? null;
    let testSetId = refs.test_set_id ?? null;
    if (refs.question_version_id) {
      const q = (await this.catalog.loadByVersionIds([refs.question_version_id])).get(refs.question_version_id);
      if (!q) throw new NotFound('question_version', refs.question_version_id);
      if (questionId && questionId !== q.question_id) throw new ValidationFailed({ issues: [{ path: 'question_id', message: 'question_id does not match question_version_id' }] });
      questionId = q.question_id;
    }
    if (refs.attempt_id) {
      const a = await this.insights.assertOwned(userId, refs.attempt_id);
      if (refs.question_version_id && !a.questionVersionIds.includes(refs.question_version_id)) throw new ValidationFailed({ issues: [{ path: 'question_version_id', message: 'question is not part of the attempt' }] });
      testSetId = testSetId ?? a.testSetId;
    }
    return { questionId, testSetId, data: { question_version_id: refs.question_version_id ?? null, attempt_id: refs.attempt_id ?? null } };
  }

  async create(userId: string, input: NoteRefs & { body: string }): Promise<Note> {
    const body = this.cleanBody(input.body);
    const r = await this.resolveRefs(userId, input);
    const [row] = await this.dbs.db
      .insert(learnNotes)
      .values({ userId, kind: 'user', body, questionId: r.questionId, testSetId: r.testSetId, updatedAt: new Date(), data: { ...r.data, created_at: new Date().toISOString() } })
      .returning();
    return this.toDto(row!);
  }

  private async owned(userId: string, noteId: string): Promise<NoteRow> {
    const [row] = await this.dbs.db.select().from(learnNotes).where(eq(learnNotes.id, noteId)).limit(1);
    if (!row || row.kind !== 'user') throw new NotFound('note', noteId);
    if (row.userId !== userId) throw new Forbidden();
    return row;
  }

  async update(userId: string, noteId: string, rawBody: string): Promise<Note> {
    await this.owned(userId, noteId);
    const body = this.cleanBody(rawBody);
    const [row] = await this.dbs.db.update(learnNotes).set({ body, updatedAt: new Date() }).where(eq(learnNotes.id, noteId)).returning();
    return this.toDto(row!);
  }

  async remove(userId: string, noteId: string): Promise<void> {
    await this.owned(userId, noteId);
    await this.dbs.db.delete(learnNotes).where(eq(learnNotes.id, noteId));
  }

  /** PUT /notes (spec v1.0): ghi đè ghi chú mới nhất theo câu (hoặc đề nếu không có câu), không có → tạo */
  async upsert(userId: string, input: NoteRefs & { body: string }): Promise<Note> {
    const body = this.cleanBody(input.body);
    const r = await this.resolveRefs(userId, input);
    if (!r.questionId && !r.testSetId) return this.create(userId, input);
    const [existing] = await this.dbs.db
      .select()
      .from(learnNotes)
      .where(and(eq(learnNotes.userId, userId), eq(learnNotes.kind, 'user'), r.questionId ? eq(learnNotes.questionId, r.questionId) : and(eq(learnNotes.testSetId, r.testSetId!), sql`${learnNotes.questionId} is null`)))
      .orderBy(desc(learnNotes.updatedAt))
      .limit(1);
    if (!existing) return this.create(userId, input);
    const prev = (existing.data as NoteData | null) ?? {};
    const [row] = await this.dbs.db
      .update(learnNotes)
      .set({ body, updatedAt: new Date(), testSetId: r.testSetId ?? existing.testSetId, data: { ...prev, question_version_id: r.data.question_version_id ?? prev.question_version_id ?? null, attempt_id: r.data.attempt_id ?? prev.attempt_id ?? null } })
      .where(eq(learnNotes.id, existing.id))
      .returning();
    return this.toDto(row!);
  }

  async list(userId: string, f: NoteRefs & { q?: string; kind?: 'user' | 'system_summary'; cursor?: string; limit: number }): Promise<{ data: Note[]; next_cursor: string | null }> {
    const c = decodeCursor<{ u: string; id: string }>(f.cursor);
    const q = f.q?.trim();
    const rows = await this.dbs.db
      .select()
      .from(learnNotes)
      .where(
        and(
          eq(learnNotes.userId, userId),
          eq(learnNotes.kind, f.kind ?? 'user'),
          f.question_id ? eq(learnNotes.questionId, f.question_id) : undefined,
          f.test_set_id ? eq(learnNotes.testSetId, f.test_set_id) : undefined,
          f.question_version_id ? sql`${learnNotes.data} ->> 'question_version_id' = ${f.question_version_id}` : undefined,
          f.attempt_id ? sql`${learnNotes.data} ->> 'attempt_id' = ${f.attempt_id}` : undefined,
          q ? sql`(${learnNotes.body} ilike ${`%${likeEscape(q)}%`} or word_similarity(${q}, ${learnNotes.body}) >= 0.5)` : undefined,
          c ? sql`(${learnNotes.updatedAt}, ${learnNotes.id}) < (${c.u}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(learnNotes.updatedAt), desc(learnNotes.id))
      .limit(f.limit + 1);
    const page = rows.slice(0, f.limit);
    return { data: page.map((r) => this.toDto(r)), next_cursor: rows.length > f.limit ? encodeCursor({ u: page.at(-1)!.updatedAt.toISOString(), id: page.at(-1)!.id }) : null };
  }

  /** Ghi chú mới nhất theo câu (Review – ReviewItem.note) */
  async latestByQuestion(userId: string, questionIds: string[]): Promise<Map<string, Note>> {
    if (!questionIds.length) return new Map();
    const rows = await this.dbs.db
      .select()
      .from(learnNotes)
      .where(and(eq(learnNotes.userId, userId), eq(learnNotes.kind, 'user'), inArray(learnNotes.questionId, questionIds)))
      .orderBy(desc(learnNotes.updatedAt));
    const out = new Map<string, Note>();
    for (const r of rows) if (r.questionId && !out.has(r.questionId)) out.set(r.questionId, this.toDto(r));
    return out;
  }
}
