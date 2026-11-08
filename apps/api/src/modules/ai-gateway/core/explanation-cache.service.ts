import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { CACHE_METRICS } from '../../../shared/telemetry/metrics.js';
import { schema } from '@allingo/db';
import type { ExplainMcqOutput } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../../shared/db/db.module.js';
import { RedisService } from '../../../shared/cache/redis.module.js';

const { aiExplanationCache } = schema;
const NONE = '_';
const TTL_SECONDS = 3600;
/** Đánh dấu âm (chưa có giải thích) – put() ghi đè ngay khi có giải thích mới */
const NEGATIVE_TTL_SECONDS = 300;

/**
 * Cache giải thích (S5): khoá logic = (question_version_id, chosen_option, locale) theo `cache_key` của explain_mcq trong
 * allingo-prompts.yaml, CỘNG prompt_version_id – hàng trong ai.explanation_cache chỉ hợp lệ khi `prompt_version_id` trùng phiên bản
 * prompt đang phục vụ người dùng (active, hoặc canary của nhóm canary). Đổi active → hàng cũ là miss và bị xoá (invalidateByPromptVersion).
 * Redis (1 giờ) đặt khoá kèm prompt_version_id; ai.explanation_cache là bản bền (UNIQUE theo DDL không có prompt_version_id – A57).
 */
@Injectable()
export class ExplanationCacheService {
  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
  ) {}

  private rkey(qv: string, chosen: string | null, locale: string, promptVersionId: string) {
    return `explain:${qv}:${chosen ?? NONE}:${locale}:${promptVersionId}`;
  }

  async get(questionVersionId: string, chosenOption: string | null, locale: string, promptVersionId: string): Promise<{ content: ExplainMcqOutput; promptVersionId: string } | null> {
    const cached = await this.redis.safe((r) => r.get(this.rkey(questionVersionId, chosenOption, locale, promptVersionId)));
    if (cached && cached !== '~') {
      CACHE_METRICS.requests.inc({ cache: 'explain', result: 'hit' });
      // Đếm hit cả khi trúng Redis để báo cáo admin phản ánh đúng số lần không tốn model (không chờ kết quả)
      void this.bumpHit(questionVersionId, chosenOption, locale);
      return JSON.parse(cached) as { content: ExplainMcqOutput; promptVersionId: string };
    }
    const [row] = await this.dbs.db
      .select()
      .from(aiExplanationCache)
      .where(and(eq(aiExplanationCache.questionVersionId, questionVersionId), eq(aiExplanationCache.chosenOption, chosenOption ?? NONE), eq(aiExplanationCache.locale, locale)))
      .limit(1);
    if (!row || row.promptVersionId !== promptVersionId) {
      CACHE_METRICS.requests.inc({ cache: 'explain', result: 'miss' });
      return null;
    }
    CACHE_METRICS.requests.inc({ cache: 'explain', result: 'hit' });
    const value = { content: row.content as ExplainMcqOutput, promptVersionId };
    await this.redis.safe((r) => r.set(this.rkey(questionVersionId, chosenOption, locale, promptVersionId), JSON.stringify(value), 'EX', TTL_SECONDS));
    await this.dbs.db.update(aiExplanationCache).set({ hitCount: sql`${aiExplanationCache.hitCount} + 1` }).where(eq(aiExplanationCache.id, row.id));
    return value;
  }

  /**
   * Tra nhiều khoá một lần (S11 – sửa N+1 ở GET /attempts/{id}/review: 200 câu × (Redis GET + DB SELECT + UPDATE hit_count)).
   * Redis MGET → phần thiếu: MỘT truy vấn DB theo (question_version_id, chosen_option, locale) → ghi lại Redis (pipeline);
   * không tìm thấy → đánh dấu âm 5 phút (`~`) để lượt xem lại sau không chạm DB. KHÔNG tăng hit_count (hiển thị trong Review
   * không phải lượt giải thích – báo cáo chi phí chỉ đếm POST /ai/explain).
   */
  async getMany(keys: Array<{ questionVersionId: string; chosenOption: string | null }>, locale: string, promptVersionId: string): Promise<Map<string, { content: ExplainMcqOutput; promptVersionId: string }>> {
    const out = new Map<string, { content: ExplainMcqOutput; promptVersionId: string }>();
    if (!keys.length) return out;
    const uniq = [...new Map(keys.map((k) => [`${k.questionVersionId}:${k.chosenOption ?? NONE}`, k])).values()];
    const rkeys = uniq.map((k) => this.rkey(k.questionVersionId, k.chosenOption, locale, promptVersionId));
    const cached = (await this.redis.safe((r) => r.mget(...rkeys))) ?? rkeys.map(() => null);
    const missing: typeof uniq = [];
    uniq.forEach((k, i) => {
      const v = cached[i];
      if (v === '~') return;
      if (v) out.set(`${k.questionVersionId}:${k.chosenOption ?? NONE}`, JSON.parse(v) as { content: ExplainMcqOutput; promptVersionId: string });
      else missing.push(k);
    });
    CACHE_METRICS.requests.inc({ cache: 'explain_review', result: 'hit' }, uniq.length - missing.length);
    CACHE_METRICS.requests.inc({ cache: 'explain_review', result: 'miss' }, missing.length);
    if (!missing.length) return out;
    const rows = await this.dbs.db
      .select({ qv: aiExplanationCache.questionVersionId, opt: aiExplanationCache.chosenOption, content: aiExplanationCache.content, pv: aiExplanationCache.promptVersionId })
      .from(aiExplanationCache)
      .where(and(eq(aiExplanationCache.locale, locale), sql`(${aiExplanationCache.questionVersionId}, ${aiExplanationCache.chosenOption}) in (${sql.join(missing.map((k) => sql`(${k.questionVersionId}::uuid, ${k.chosenOption ?? NONE})`), sql`, `)})`));
    const found = new Map(rows.filter((r) => r.pv === promptVersionId).map((r) => [`${r.qv}:${r.opt}`, { content: r.content as ExplainMcqOutput, promptVersionId }]));
    await this.redis.safe((r) => {
      const p = r.pipeline();
      for (const k of missing) {
        const id = `${k.questionVersionId}:${k.chosenOption ?? NONE}`;
        const v = found.get(id);
        if (v) p.set(this.rkey(k.questionVersionId, k.chosenOption, locale, promptVersionId), JSON.stringify(v), 'EX', TTL_SECONDS);
        else p.set(this.rkey(k.questionVersionId, k.chosenOption, locale, promptVersionId), '~', 'EX', NEGATIVE_TTL_SECONDS);
      }
      return p.exec();
    });
    for (const [id, v] of found) out.set(id, v);
    return out;
  }

  private async bumpHit(questionVersionId: string, chosenOption: string | null, locale: string): Promise<void> {
    try {
      await this.dbs.db
        .update(aiExplanationCache)
        .set({ hitCount: sql`${aiExplanationCache.hitCount} + 1` })
        .where(and(eq(aiExplanationCache.questionVersionId, questionVersionId), eq(aiExplanationCache.chosenOption, chosenOption ?? NONE), eq(aiExplanationCache.locale, locale)));
    } catch {
      /* chỉ là số liệu thống kê */
    }
  }

  /** Tổng số lần trúng cache giải thích (cho báo cáo chi phí AI) */
  async totalHits(): Promise<number> {
    const [r] = await this.dbs.db.select({ n: sql<number>`coalesce(sum(${aiExplanationCache.hitCount}), 0)::int` }).from(aiExplanationCache);
    return r?.n ?? 0;
  }

  async put(tx: DbOrTx, questionVersionId: string, chosenOption: string | null, locale: string, content: ExplainMcqOutput, promptVersionId: string): Promise<void> {
    await tx
      .insert(aiExplanationCache)
      .values({ questionVersionId, chosenOption: chosenOption ?? NONE, locale, content, promptVersionId })
      .onConflictDoUpdate({ target: [aiExplanationCache.questionVersionId, aiExplanationCache.chosenOption, aiExplanationCache.locale], set: { content, promptVersionId, hitCount: 0, qualityScore: null, createdAt: new Date() } });
    await this.redis.safe((r) => r.set(this.rkey(questionVersionId, chosenOption, locale, promptVersionId), JSON.stringify({ content, promptVersionId }), 'EX', TTL_SECONDS));
  }

  /** Điểm chất lượng từ phản hồi người học (EMA α = 0,2; helpful = 1, not_helpful/wrong = 0) */
  async recordFeedback(questionVersionId: string, chosenOption: string | null, locale: string, positive: boolean): Promise<void> {
    const v = positive ? 1 : 0;
    await this.dbs.db
      .update(aiExplanationCache)
      .set({ qualityScore: sql`round((coalesce(${aiExplanationCache.qualityScore}, ${v}) * 0.8 + ${v} * 0.2)::numeric, 2)` })
      .where(and(eq(aiExplanationCache.questionVersionId, questionVersionId), eq(aiExplanationCache.chosenOption, chosenOption ?? NONE), eq(aiExplanationCache.locale, locale)));
  }

  private async deleteRedis(pattern: string): Promise<number> {
    const n = await this.redis.safe(async (r) => {
      let cursor = '0';
      let removed = 0;
      do {
        const [next, keys] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        if (keys.length) removed += await r.del(...keys);
      } while (cursor !== '0');
      return removed;
    });
    return n ?? 0;
  }

  /** Xoá cache của một phiên bản câu hỏi (nội dung câu đổi/thu hồi; test) */
  async invalidateVersion(questionVersionId: string): Promise<void> {
    await this.dbs.db.delete(aiExplanationCache).where(eq(aiExplanationCache.questionVersionId, questionVersionId));
    await this.deleteRedis(`explain:${questionVersionId}:*`);
  }

  /** Phiên bản prompt bị thay (active đổi/retired) → xoá mọi giải thích sinh bởi phiên bản đó. Trả số hàng DB đã xoá. */
  async invalidateByPromptVersion(promptVersionId: string): Promise<number> {
    const rows = await this.dbs.db.delete(aiExplanationCache).where(eq(aiExplanationCache.promptVersionId, promptVersionId)).returning({ id: aiExplanationCache.id });
    await this.deleteRedis(`explain:*:${promptVersionId}`);
    return rows.length;
  }
}
