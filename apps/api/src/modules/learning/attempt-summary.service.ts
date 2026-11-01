import { Injectable, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { JOB_NAMES, SUMMARY_EVERY_N_ATTEMPTS, type ScoreBreakdown, type SummarizeAttemptOutput } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { AiGatewayService } from '../ai-gateway/index.js';
import { UsersService } from '../iam/index.js';
import { AttemptsService } from '../test-engine/index.js';

const { learnNotes } = schema;

/** Loại việc tiếp theo được phép gợi ý (learn.plan_task_type – S9 dùng cho lộ trình) */
const ALLOWED_TASK_TYPES = ['part_drill', 'timed_drill', 'full_test', 'review_errors', 'vocab_review', 'grammar', 'lesson'];

interface GradedPayload {
  attempt_id: string;
  user_id: string;
  program?: string;
}

/** Thu mọi số trong một giá trị JSON (để kiểm tra numeric fidelity) */
function numbersIn(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === 'number' && Number.isFinite(v)) {
    out.add(String(v));
    out.add(String(Math.round(v)));
  } else if (typeof v === 'string') for (const m of v.match(/\d+(?:[.,]\d+)?/g) ?? []) out.add(m.replace(',', '.'));
  else if (Array.isArray(v)) for (const x of v) numbersIn(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    numbersIn(k, out);
    numbersIn(x, out);
  }
  return out;
}

/**
 * Mọi con số trong văn bản AI phải có trong <data> (summarize_attempt: "the server will reject any figure not present").
 * Trả các số lạ (rỗng = đạt). Bỏ qua số 1 chữ số ≤ 3 dùng để đếm danh sách ("3 bước").
 */
export function numericFidelity(output: SummarizeAttemptOutput, data: Record<string, unknown>): string[] {
  const allowed = numbersIn(data);
  const texts = [output.headline, output.weakest.area, output.weakest.evidence, output.trend_note ?? '', ...output.next_tasks.map((t) => `${t.reason} ${t.ref_hint ?? ''}`)];
  const bad: string[] = [];
  for (const t of texts) {
    for (const m of t.match(/\d+(?:[.,]\d+)?/g) ?? []) {
      const n = m.replace(',', '.');
      if (Number(n) <= 3 && !n.includes('.')) continue;
      if (!allowed.has(n) && !allowed.has(String(Number(n)))) bad.push(m);
    }
  }
  return bad;
}

/**
 * Tóm tắt tiến bộ (summarize_attempt, S5): sau mỗi SUMMARY_EVERY_N_ATTEMPTS (3) bài đã chấm của người học trong một chương trình
 * → job `summary.attempt` (jobId = summary.attempt__<attempt_id>, idempotent) → AiGateway (không trừ credit – tác vụ hệ thống, A60)
 * → kiểm tra numeric fidelity → `learn.notes` kind=system_summary (unique theo attempt_id). Dashboard dùng ở S10.
 * Nghe cả `local.attempt.graded` (cùng process) và `outbox.attempt.graded` (worker relay) – trùng thì jobId/unique index chặn.
 */
@Injectable()
export class AttemptSummaryService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'learning.summary' });

  constructor(
    private readonly dbs: DbService,
    private readonly jobs: JobsService,
    private readonly gateway: AiGatewayService,
    private readonly attempts: AttemptsService,
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('grading', JOB_NAMES.SUMMARY_ATTEMPT, (payload) => this.run(payload as unknown as GradedPayload));
  }

  @OnEvent('local.attempt.graded')
  async onLocal(payload: GradedPayload): Promise<void> {
    await this.maybeEnqueue(payload).catch((err: Error) => this.logger.warn({ err: err.message, attempt_id: payload.attempt_id }, 'summary enqueue failed'));
  }

  @OnEvent('outbox.attempt.graded')
  async onOutbox(ev: { payload: GradedPayload }): Promise<void> {
    await this.maybeEnqueue(ev.payload).catch((err: Error) => this.logger.warn({ err: err.message, attempt_id: ev.payload.attempt_id }, 'summary enqueue failed'));
  }

  /** Bài thứ 3, 6, 9… của người học trong chương trình → đặt job. Trả jobId (hoặc null nếu chưa đến lượt). */
  async maybeEnqueue(p: GradedPayload): Promise<{ jobId: string; done?: Promise<unknown> } | null> {
    if (!p?.attempt_id || !p.user_id) return null;
    const program = p.program ?? 'toeic';
    // Vị trí của CHÍNH attempt này (không phải tổng hiện tại) → sự kiện đến muộn/trùng không đặt job sai
    const n = await this.attempts.gradedPosition(p.user_id, program, p.attempt_id);
    if (!n || n % SUMMARY_EVERY_N_ATTEMPTS !== 0) return null;
    const d = await this.jobs.dispatch('grading', JOB_NAMES.SUMMARY_ATTEMPT, p.attempt_id, { attempt_id: p.attempt_id, user_id: p.user_id, program });
    return { jobId: d.jobId, done: d.done };
  }

  /** Bộ xử lý job summary.attempt */
  async run(p: GradedPayload): Promise<{ note_id: string | null; skipped?: string; ai_task_id?: string }> {
    const program = p.program ?? 'toeic';
    const [existing] = await this.dbs.db
      .select({ id: learnNotes.id })
      .from(learnNotes)
      .where(and(eq(learnNotes.userId, p.user_id), eq(learnNotes.kind, 'system_summary'), sql`${learnNotes.data} ->> 'attempt_id' = ${p.attempt_id}`))
      .limit(1);
    if (existing) return { note_id: existing.id, skipped: 'exists' };
    const rows = await this.attempts.statsSource(p.user_id, program);
    const idx = rows.findIndex((r) => r.id === p.attempt_id);
    if (idx < 0) return { note_id: null, skipped: 'attempt_not_graded' };
    const window = rows.slice(idx, idx + SUMMARY_EVERY_N_ATTEMPTS);
    const latest = window[0]!;
    const b = (latest.breakdown ?? {}) as ScoreBreakdown;
    const data = {
      program,
      mode: latest.mode,
      scaled_score: latest.scaled !== null ? Number(latest.scaled) : null,
      previous_scores: window.slice(1).map((r) => (r.scaled !== null ? Number(r.scaled) : null)).filter((x): x is number => x !== null),
      by_section: Object.fromEntries(Object.entries(b.by_section ?? {}).map(([k, v]) => [k, { correct: v.correct, total: v.total }])),
      by_question_type: b.by_question_type ?? {},
      by_subskill: b.by_subskill ?? {},
      timing: { time_spent_sec: latest.timeSpentSec ?? null, by_section_avg_ms: Object.fromEntries(Object.entries(b.by_section ?? {}).map(([k, v]) => [k, v.avg_time_ms ?? null])) },
      allowed_task_types: ALLOWED_TASK_TYPES,
    };
    const user = await this.users.findById(p.user_id);
    const r = await this.gateway.runTask<SummarizeAttemptOutput>({ taskCode: 'summarize_attempt', userId: p.user_id, chargeCredits: false, variables: data, locale: user?.explainLocale ?? 'vi', program, inputRef: { attempt_id: p.attempt_id, attempt_ids: window.map((w) => w.id), purpose: 'summary' } });
    const bad = numericFidelity(r.data, data);
    if (bad.length) {
      this.logger.warn({ attempt_id: p.attempt_id, ai_task_id: r.aiTaskId, numbers: bad.slice(0, 5) }, 'summary rejected: numbers not present in data');
      return { note_id: null, skipped: 'numeric_fidelity', ai_task_id: r.aiTaskId };
    }
    const body = [r.data.headline, `• ${r.data.weakest.area}: ${r.data.weakest.evidence}`, ...r.data.next_tasks.map((t) => `→ ${t.task_type}${t.ref_hint ? ` (${t.ref_hint})` : ''}: ${t.reason}`), r.data.trend_note ?? ''].filter(Boolean).join('\n');
    const [note] = await this.dbs.db
      .insert(learnNotes)
      .values({ userId: p.user_id, body, kind: 'system_summary', data: { attempt_id: p.attempt_id, attempt_ids: window.map((w) => w.id), program, summary: r.data, ai_task_id: r.aiTaskId, prompt_version_id: r.promptVersionId, created_at: new Date().toISOString() } })
      .onConflictDoNothing()
      .returning({ id: learnNotes.id });
    return { note_id: note?.id ?? null, ai_task_id: r.aiTaskId, ...(note ? {} : { skipped: 'exists' }) };
  }

  /** Thẻ tóm tắt gần nhất (S10 dashboard) */
  async latest(userId: string, limit = 5) {
    return this.dbs.db.select().from(learnNotes).where(and(eq(learnNotes.userId, userId), eq(learnNotes.kind, 'system_summary'))).orderBy(desc(learnNotes.updatedAt)).limit(limit);
  }
}
