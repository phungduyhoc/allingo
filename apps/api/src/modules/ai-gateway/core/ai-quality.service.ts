import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../../../shared/db/db.module.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/cursor.js';

/**
 * Chất lượng AI cho admin (S12): theo phiên bản prompt – số tác vụ, thành công/refused/lỗi, 👍 (helpful) / 👎 (not_helpful|wrong),
 * chi phí; mẫu tác vụ bị guardrail từ chối (chỉ mã lý do + input_ref id – không nội dung người học). Dọn ai_tasks cũ (retention).
 */
@Injectable()
export class AiQualityService {
  constructor(private readonly dbs: DbService) {}

  async quality(from: Date, to: Date, taskCode?: string) {
    const rows = (await this.dbs.db.execute(sql`
      select t.task_code, t.prompt_version_id, pv.version_no, pv.status as prompt_status,
        count(*)::int as tasks,
        count(*) filter (where t.status = 'succeeded')::int as succeeded,
        count(*) filter (where t.status = 'refused')::int as refused,
        count(*) filter (where t.status = 'failed')::int as failed,
        coalesce(sum(t.cost_usd), 0)::float8 as cost_usd,
        coalesce(sum((select count(*) from ai.feedback f where f.ai_task_id = t.id and f.rating = 'helpful')), 0)::int as up,
        coalesce(sum((select count(*) from ai.feedback f where f.ai_task_id = t.id and f.rating in ('not_helpful','wrong'))), 0)::int as down
      from ai.ai_tasks t left join ai.prompt_versions pv on pv.id = t.prompt_version_id
      where t.created_at >= ${from.toISOString()}::timestamptz and t.created_at <= ${to.toISOString()}::timestamptz
        ${taskCode ? sql`and t.task_code = ${taskCode}` : sql``}
      group by t.task_code, t.prompt_version_id, pv.version_no, pv.status
      order by t.task_code, pv.version_no nulls last`)) as unknown as Array<{ task_code: string; prompt_version_id: string | null; version_no: number | null; prompt_status: string | null; tasks: number; succeeded: number; refused: number; failed: number; cost_usd: number; up: number; down: number }>;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      data: rows.map((r) => ({ task_code: r.task_code, prompt_version_id: r.prompt_version_id, prompt_version_no: r.version_no, prompt_status: r.prompt_status, tasks: r.tasks, succeeded: r.succeeded, refused: r.refused, failed: r.failed, thumbs_up: r.up, thumbs_down: r.down, thumbs_up_ratio: r.up + r.down ? Math.round((r.up / (r.up + r.down)) * 1000) / 1000 : null, cost_usd: Math.round(Number(r.cost_usd) * 1_000_000) / 1_000_000 })),
    };
  }

  async refusals(from: Date, to: Date, cursor: string | undefined, limit: number) {
    const c = decodeCursor<{ at: string; id: string }>(cursor);
    const rows = (await this.dbs.db.execute(sql`
      select id, task_code, error, error_code, input_ref, created_at from ai.ai_tasks
      where status = 'refused' and created_at >= ${from.toISOString()}::timestamptz and created_at <= ${to.toISOString()}::timestamptz
        ${c ? sql`and (created_at, id) < (${c.at}::timestamptz, ${c.id}::uuid)` : sql``}
      order by created_at desc, id desc limit ${limit + 1}`)) as unknown as Array<{ id: string; task_code: string; error: string | null; error_code: string | null; input_ref: Record<string, unknown> | null; created_at: string | Date }>;
    const page = rows.slice(0, limit);
    const by = (await this.dbs.db.execute(sql`select coalesce(error, 'unknown') as reason, count(*)::int as n from ai.ai_tasks where status = 'refused' and created_at >= ${from.toISOString()}::timestamptz and created_at <= ${to.toISOString()}::timestamptz group by 1`)) as unknown as Array<{ reason: string; n: number }>;
    const last = page[page.length - 1];
    // input_ref chỉ giữ khoá *_id (không nội dung)
    const refOnly = (r: Record<string, unknown> | null) => (r ? Object.fromEntries(Object.entries(r).filter(([k, v]) => /_id$/.test(k) && typeof v === 'string')) : null);
    return {
      data: page.map((r) => ({ id: r.id, task_code: r.task_code, reason: (r.error ?? 'unknown').slice(0, 120), error_code: r.error_code, input_ref: refOnly(r.input_ref), created_at: new Date(r.created_at).toISOString() })),
      next_cursor: rows.length > limit && last ? encodeCursor({ at: new Date(last.created_at).toISOString(), id: last.id }) : null,
      by_reason: Object.fromEntries(by.map((x) => [x.reason.slice(0, 120), x.n])),
    };
  }

  /** Retention: xoá ai_tasks cũ hơn `before` theo lô (bảng partition – DELETE theo created_at để tỉa partition) */
  async purgeBefore(before: Date, batch: number): Promise<number> {
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const r = (await this.dbs.db.execute(sql`
        delete from ai.ai_tasks where (id, created_at) in (select id, created_at from ai.ai_tasks where created_at < ${before.toISOString()}::timestamptz limit ${batch}) returning 1`)) as unknown as unknown[];
      total += r.length;
      if (r.length < batch) break;
    }
    return total;
  }
}
