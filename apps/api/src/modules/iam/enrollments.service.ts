import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { Enrollment, EnrollmentInput, ProgramCode } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { NotFound } from '../../shared/http/errors.js';

const { learnEnrollments, learnAttempts } = schema;
type Row = typeof learnEnrollments.$inferSelect;

@Injectable()
export class EnrollmentsService {
  constructor(private readonly dbs: DbService) {}

  /** C1: `current` = chương trình đang học (UsersService.activeProgram) → `is_current` */
  async list(userId: string, current: string | null = null): Promise<Enrollment[]> {
    const rows = await this.dbs.db.select().from(learnEnrollments).where(eq(learnEnrollments.userId, userId)).orderBy(desc(learnEnrollments.updatedAt));
    return Promise.all(rows.map(async (r) => ({ ...(await this.toDto(r)), is_current: r.programCode === current })));
  }

  /** C1: chọn chương trình đang học – tạo enrollment nếu chưa có, bật lại nếu đã tắt; KHÔNG đổi mục tiêu/ngày thi/phút học */
  async activate(userId: string, program: ProgramCode, db: DbOrTx = this.dbs.db): Promise<void> {
    const row = await this.ensure(userId, program, db);
    if (!row.isActive) await db.update(learnEnrollments).set({ isActive: true, updatedAt: new Date() }).where(eq(learnEnrollments.id, row.id));
  }

  async get(userId: string, program: ProgramCode, db: DbOrTx = this.dbs.db): Promise<Row | null> {
    const [row] = await db.select().from(learnEnrollments).where(and(eq(learnEnrollments.userId, userId), eq(learnEnrollments.programCode, program))).limit(1);
    return row ?? null;
  }

  /** Tạo hoặc kích hoạt lại; đồng thời là "chương trình đang học" */
  async upsert(userId: string, input: EnrollmentInput, db: DbOrTx = this.dbs.db): Promise<Enrollment> {
    const existing = await this.get(userId, input.program, db);
    const patch = {
      targetScore: input.target_score !== undefined ? String(input.target_score) : undefined,
      targetLevel: input.target_level,
      examDate: input.exam_date,
      dailyMinutes: input.daily_minutes,
      currentLevel: input.self_assessed_level ? { self_assessed: input.self_assessed_level } : undefined,
      isActive: true,
      updatedAt: new Date(),
    };
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<Row>;
    if (existing) {
      const [row] = await db.update(learnEnrollments).set(clean).where(eq(learnEnrollments.id, existing.id)).returning();
      return this.toDto(row!);
    }
    const [row] = await db
      .insert(learnEnrollments)
      .values({ userId, programCode: input.program, dailyMinutes: input.daily_minutes ?? 30, ...clean })
      .returning();
    return this.toDto(row!);
  }

  async patch(userId: string, program: ProgramCode, input: EnrollmentInput): Promise<Enrollment> {
    const existing = await this.get(userId, program);
    if (!existing) throw new NotFound('enrollment', program);
    return this.upsert(userId, { ...input, program });
  }

  /** S9 – ghi mức hiện tại ước tính (kết quả bài chẩn đoán) vào `current_level` (gộp với giá trị cũ, vd self_assessed) */
  async setCurrentLevel(userId: string, program: ProgramCode, level: Record<string, unknown>, db: DbOrTx = this.dbs.db): Promise<void> {
    const row = await this.ensure(userId, program, db);
    await db
      .update(learnEnrollments)
      .set({ currentLevel: { ...((row.currentLevel) ?? {}), ...level }, updatedAt: new Date() })
      .where(eq(learnEnrollments.id, row.id));
  }

  /** S9 – nhiều enrollment theo id (learning: người học của các lộ trình cần nhắc) */
  /** S10: trọng số FSRS-5 tối ưu theo (người dùng, chương trình) – learn.enrollments.fsrs_params */
  async fsrsParams(userId: string, program: string): Promise<{ w?: number[]; model?: string } | null> {
    const [row] = await this.dbs.db.select({ p: learnEnrollments.fsrsParams }).from(learnEnrollments).where(and(eq(learnEnrollments.userId, userId), eq(learnEnrollments.programCode, program))).limit(1);
    return (row?.p as { w?: number[]; model?: string } | null) ?? null;
  }

  async setFsrsParams(userId: string, program: ProgramCode, params: Record<string, unknown>): Promise<void> {
    const row = await this.ensure(userId, program);
    await this.dbs.db.update(learnEnrollments).set({ fsrsParams: params }).where(eq(learnEnrollments.id, row.id));
  }

  async byIds(ids: string[]): Promise<Row[]> {
    if (!ids.length) return [];
    return this.dbs.db.select().from(learnEnrollments).where(inArray(learnEnrollments.id, [...new Set(ids)]));
  }

  async ensure(userId: string, program: ProgramCode, db: DbOrTx = this.dbs.db): Promise<Row> {
    const existing = await this.get(userId, program, db);
    if (existing) return existing;
    // S11 (pentest #6): request đồng thời cho người dùng mới → ON CONFLICT DO NOTHING rồi đọc lại (trước: 500 unique violation)
    const [row] = await db.insert(learnEnrollments).values({ userId, programCode: program, dailyMinutes: 30, isActive: true }).onConflictDoNothing({ target: [learnEnrollments.userId, learnEnrollments.programCode] }).returning();
    if (row) return row;
    const again = await this.get(userId, program, db);
    if (!again) throw new Error('enrollment ensure race: row not visible after conflict');
    return again;
  }

  private async toDto(r: Row): Promise<Enrollment> {
    const [diag] = await this.dbs.db
      .select({ id: learnAttempts.id })
      .from(learnAttempts)
      .where(and(eq(learnAttempts.userId, r.userId), eq(learnAttempts.programCode, r.programCode), eq(learnAttempts.mode, 'diagnostic'), eq(learnAttempts.status, 'graded')))
      .orderBy(desc(learnAttempts.submittedAt))
      .limit(1);
    const daysToExam = r.examDate ? Math.ceil((new Date(r.examDate).getTime() - Date.now()) / 86_400_000) : null;
    return {
      id: r.id,
      program: r.programCode as ProgramCode,
      target_score: r.targetScore !== null ? Number(r.targetScore) : null,
      target_level: r.targetLevel ?? null,
      exam_date: r.examDate ?? null,
      daily_minutes: r.dailyMinutes,
      current_level: (r.currentLevel as Record<string, unknown> | null) ?? null,
      days_to_exam: daysToExam,
      diagnostic_attempt_id: diag?.id ?? null,
      started_at: r.startedAt.toISOString(),
      is_active: r.isActive,
    };
  }
}
