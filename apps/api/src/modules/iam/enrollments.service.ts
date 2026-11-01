import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { Enrollment, EnrollmentInput, ProgramCode } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { NotFound } from '../../shared/http/errors.js';

const { learnEnrollments, learnAttempts } = schema;
type Row = typeof learnEnrollments.$inferSelect;

@Injectable()
export class EnrollmentsService {
  constructor(private readonly dbs: DbService) {}

  async list(userId: string): Promise<Enrollment[]> {
    const rows = await this.dbs.db.select().from(learnEnrollments).where(eq(learnEnrollments.userId, userId)).orderBy(desc(learnEnrollments.updatedAt));
    return Promise.all(rows.map((r) => this.toDto(r)));
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

  async ensure(userId: string, program: ProgramCode, db: DbOrTx = this.dbs.db): Promise<Row> {
    const existing = await this.get(userId, program, db);
    if (existing) return existing;
    const [row] = await db.insert(learnEnrollments).values({ userId, programCode: program, dailyMinutes: 30, isActive: true }).returning();
    return row!;
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
    };
  }
}
