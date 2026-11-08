import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../../shared/db/db.module.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';

export type QuestionRecommendation = 'retire' | 'review' | 'ok' | 'insufficient_data';

export interface QuestionStatsValue {
  n: number;
  correct: number;
  p_value: number | null;
  discrimination: number | null;
  avg_time_ms: number | null;
  reports_open: number;
  reports_confirmed: number;
  reports_total: number;
  recommendation: QuestionRecommendation;
  reasons: string[];
  window_days: number;
  computed_at: string;
}

const SORTS: Record<string, string> = {
  p_value: "(q.stats->>'p_value')::numeric asc nulls last",
  discrimination: "(q.stats->>'discrimination')::numeric asc nulls last",
  reports: "(q.stats->>'reports_total')::int desc nulls last",
  n: "(q.stats->>'n')::int desc nulls last",
  avg_time: "(q.stats->>'avg_time_ms')::int desc nulls last",
};

/**
 * Thống kê câu hỏi lưu ở catalog.questions.stats (S12) – job content.stats_nightly (analytics) tính rồi gọi `save` (module
 * catalog sở hữu bảng). Cập nhật đồng thời exposure_count/correct_count/avg_time_ms theo cửa sổ thống kê.
 */
@Injectable()
export class QuestionStatsService {
  constructor(private readonly dbs: DbService) {}

  async save(rows: Array<{ questionId: string; stats: QuestionStatsValue }>): Promise<number> {
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      if (!chunk.length) continue;
      const payload = JSON.stringify(chunk.map((r) => ({ id: r.questionId, stats: r.stats })));
      const res = (await this.dbs.db.execute(sql`
        update catalog.questions q set stats = x.stats, stats_updated_at = now(),
          exposure_count = greatest(q.exposure_count, (x.stats->>'n')::int),
          correct_count = greatest(q.correct_count, (x.stats->>'correct')::int),
          avg_time_ms = coalesce((x.stats->>'avg_time_ms')::int, q.avg_time_ms)
        from jsonb_to_recordset(${payload}::jsonb) as x(id uuid, stats jsonb)
        where q.id = x.id returning q.id`)) as unknown as unknown[];
      n += res.length;
    }
    return n;
  }

  async list(q: { program?: string; section?: string; recommendation?: string; sort?: string; min_n?: number; cursor?: string; limit: number }) {
    const offset = Number(decodeCursor<{ o: number }>(q.cursor)?.o ?? 0) || 0;
    const where = [sql`q.stats is not null`];
    if (q.program) where.push(sql`q.program_code = ${q.program}`);
    if (q.section) where.push(sql`s.code = ${q.section}`);
    if (q.recommendation) where.push(sql`q.stats->>'recommendation' = ${q.recommendation}`);
    if (q.min_n !== undefined) where.push(sql`(q.stats->>'n')::int >= ${q.min_n}`);
    const order = sql.raw(SORTS[q.sort ?? ''] ?? "case q.stats->>'recommendation' when 'retire' then 0 when 'review' then 1 when 'ok' then 2 else 3 end, (q.stats->>'n')::int desc");
    const rows = (await this.dbs.db.execute(sql`
      select q.id, q.program_code, q.status, s.code as section_code, q.stats, q.stats_updated_at,
             (select v.metadata->>'external_ref' from catalog.question_versions v where v.id = q.current_version_id) as external_ref
      from catalog.questions q left join catalog.sections s on s.id = q.section_id
      where ${sql.join(where, sql` and `)}
      order by ${order}, q.id
      limit ${q.limit + 1} offset ${offset}`)) as unknown as Array<{ id: string; program_code: string; status: string; section_code: string | null; stats: QuestionStatsValue; stats_updated_at: string | Date | null; external_ref: string | null }>;
    const page = rows.slice(0, q.limit);
    const [last] = (await this.dbs.db.execute(sql`select max(stats_updated_at) as at from catalog.questions`)) as unknown as Array<{ at: string | Date | null }>;
    return {
      data: page.map((r) => ({
        question_id: r.id,
        external_ref: r.external_ref,
        program: r.program_code,
        section_code: r.section_code,
        status: r.status,
        n: r.stats.n,
        p_value: r.stats.p_value,
        discrimination: r.stats.discrimination,
        avg_time_ms: r.stats.avg_time_ms,
        reports_open: r.stats.reports_open,
        reports_total: r.stats.reports_total,
        recommendation: r.stats.recommendation,
        reasons: r.stats.reasons,
        computed_at: r.stats.computed_at ?? null,
      })),
      next_cursor: rows.length > q.limit ? encodeCursor({ o: offset + q.limit }) : null,
      computed_at: last?.at ? new Date(last.at).toISOString() : null,
    };
  }
}
