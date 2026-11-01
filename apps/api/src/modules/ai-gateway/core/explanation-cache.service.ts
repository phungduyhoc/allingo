import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { ExplainMcqOutput } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../../shared/db/db.module.js';
import { RedisService } from '../../../shared/cache/redis.module.js';

const { aiExplanationCache } = schema;
const NONE = '_';

/** Cache giải thích theo (question_version_id, chosen_option, locale): Redis (1 giờ) + ai.explanation_cache (bền) */
@Injectable()
export class ExplanationCacheService {
  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
  ) {}

  private rkey(qv: string, chosen: string | null, locale: string) {
    return `explain:${qv}:${chosen ?? NONE}:${locale}`;
  }

  async get(questionVersionId: string, chosenOption: string | null, locale: string): Promise<{ content: ExplainMcqOutput; promptVersionId: string | null } | null> {
    const cached = await this.redis.safe((r) => r.get(this.rkey(questionVersionId, chosenOption, locale)));
    if (cached) {
      // Đếm hit cả khi trúng Redis để báo cáo admin phản ánh đúng số lần không tốn model (không chờ kết quả)
      void this.bumpHit(questionVersionId, chosenOption, locale);
      return JSON.parse(cached) as { content: ExplainMcqOutput; promptVersionId: string | null };
    }
    const [row] = await this.dbs.db
      .select()
      .from(aiExplanationCache)
      .where(and(eq(aiExplanationCache.questionVersionId, questionVersionId), eq(aiExplanationCache.chosenOption, chosenOption ?? NONE), eq(aiExplanationCache.locale, locale)))
      .limit(1);
    if (!row) return null;
    const value = { content: row.content as ExplainMcqOutput, promptVersionId: row.promptVersionId ?? null };
    await this.redis.safe((r) => r.set(this.rkey(questionVersionId, chosenOption, locale), JSON.stringify(value), 'EX', 3600));
    await this.dbs.db.update(aiExplanationCache).set({ hitCount: sql`${aiExplanationCache.hitCount} + 1` }).where(eq(aiExplanationCache.id, row.id));
    return value;
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

  async put(tx: DbOrTx, questionVersionId: string, chosenOption: string | null, locale: string, content: ExplainMcqOutput, promptVersionId: string | null): Promise<void> {
    await tx
      .insert(aiExplanationCache)
      .values({ questionVersionId, chosenOption: chosenOption ?? NONE, locale, content, promptVersionId })
      .onConflictDoUpdate({ target: [aiExplanationCache.questionVersionId, aiExplanationCache.chosenOption, aiExplanationCache.locale], set: { content, promptVersionId, createdAt: new Date() } });
    await this.redis.safe((r) => r.set(this.rkey(questionVersionId, chosenOption, locale), JSON.stringify({ content, promptVersionId }), 'EX', 3600));
  }

  async invalidateVersion(questionVersionId: string): Promise<void> {
    await this.dbs.db.delete(aiExplanationCache).where(eq(aiExplanationCache.questionVersionId, questionVersionId));
    await this.redis.safe(async (r) => {
      const keys = await r.keys(`explain:${questionVersionId}:*`);
      if (keys.length) await r.del(...keys);
      return null;
    });
  }
}
