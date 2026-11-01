import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, param, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { EMBEDDING_DIMENSIONS } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { DbService } from '../../../shared/db/db.module.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { AI_METRICS } from '../../../shared/telemetry/metrics.js';
import { MockEmbeddingProvider, VercelEmbeddingProvider, type EmbeddingProvider } from '../providers/embedding.provider.js';

const { aiEmbeddings } = schema;

export const toVectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? Math.round(x * 1e7) / 1e7 : 0)).join(',')}]`;

/**
 * Embedding (S5) – sở hữu ai.embeddings; mọi lời gọi model embedding đi qua đây (trong module ai-gateway – CLAUDE.md §5.2).
 * Provider: AI_EMBEDDING_PROVIDER=auto → mock khi AI_PROVIDER=mock; live → OpenAI (nếu có khoá) → Google → mock.
 * Tìm gần nhất bằng cosine của pgvector (`<=>`, index HNSW). Module khác lọc theo nghiệp vụ (vd catalog: chỉ câu published).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = getLogger({ component: 'ai.embedding' });
  private provider: EmbeddingProvider;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
  ) {
    this.provider = EmbeddingService.pick(env);
  }

  static pick(env: Env): EmbeddingProvider {
    const want = env.AI_EMBEDDING_PROVIDER === 'auto' ? (env.AI_PROVIDER === 'mock' ? 'mock' : env.OPENAI_API_KEY ? 'openai' : env.GOOGLE_GENERATIVE_AI_API_KEY ? 'google' : 'mock') : env.AI_EMBEDDING_PROVIDER;
    if (want === 'openai' && env.OPENAI_API_KEY) return new VercelEmbeddingProvider('openai', env.OPENAI_API_KEY, env.OPENAI_EMBEDDING_MODEL);
    if (want === 'google' && env.GOOGLE_GENERATIVE_AI_API_KEY) return new VercelEmbeddingProvider('google', env.GOOGLE_GENERATIVE_AI_API_KEY, env.GEMINI_EMBEDDING_MODEL);
    return new MockEmbeddingProvider();
  }

  /** Test: thay provider */
  setProvider(p: EmbeddingProvider): void {
    this.provider = p;
  }

  get model(): string {
    return this.provider.model;
  }

  get isMock(): boolean {
    return this.provider.provider === 'mock';
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const started = Date.now();
    const out: number[][] = [];
    // Lô 64 văn bản/lần gọi
    for (let i = 0; i < texts.length; i += 64) {
      const r = await this.provider.embed(texts.slice(i, i + 64));
      out.push(...r.vectors);
      if (r.tokens) AI_METRICS.tokens.inc({ task: 'embed', model: this.provider.model, direction: 'in' }, r.tokens);
    }
    AI_METRICS.duration.observe({ task: 'embed', model: this.provider.model, status: 'succeeded' }, (Date.now() - started) / 1000);
    for (const v of out) if (v.length !== EMBEDDING_DIMENSIONS) throw new Error(`embedding dimension ${v.length} ≠ ${EMBEDDING_DIMENSIONS}`);
    return out;
  }

  /** Ghi/ghi đè embedding cho thực thể (cùng model) */
  async upsert(entityType: string, items: Array<{ id: string; text: string }>): Promise<number> {
    if (!items.length) return 0;
    const vectors = await this.embed(items.map((i) => i.text));
    for (let i = 0; i < items.length; i++) {
      await this.dbs.db
        .insert(aiEmbeddings)
        .values({ entityType, entityId: items[i]!.id, model: this.provider.model, embedding: vectors[i]! })
        .onConflictDoUpdate({ target: [aiEmbeddings.entityType, aiEmbeddings.entityId, aiEmbeddings.model], set: { embedding: vectors[i]!, createdAt: new Date() } });
    }
    return items.length;
  }

  /** Bảo đảm có embedding (chỉ tính phần còn thiếu) – trả số vector mới */
  async ensure(entityType: string, items: Array<{ id: string; text: string }>): Promise<number> {
    if (!items.length) return 0;
    const have = new Set<string>();
    for (let i = 0; i < items.length; i += 1000) {
      const ids = items.slice(i, i + 1000).map((x) => x.id);
      const rows = await this.dbs.db
        .select({ id: aiEmbeddings.entityId })
        .from(aiEmbeddings)
        .where(and(eq(aiEmbeddings.entityType, entityType), eq(aiEmbeddings.model, this.provider.model), inArray(aiEmbeddings.entityId, ids)));
      for (const r of rows) have.add(r.id);
    }
    const missing = items.filter((x) => !have.has(x.id));
    if (missing.length) this.logger.info({ entity_type: entityType, n: missing.length, model: this.provider.model }, 'embedding backfill');
    return this.upsert(entityType, missing);
  }

  /**
   * Thực thể gần nhất theo cosine (1 − khoảng cách <=>), tuỳ chọn giới hạn trong `candidateIds` (vd. câu published cùng section).
   * Trả độ giống giảm dần, chỉ phần ≥ minSimilarity.
   */
  async nearest(entityType: string, vector: number[], opts: { limit?: number; minSimilarity?: number; candidateIds?: string[] } = {}): Promise<Array<{ entity_id: string; similarity: number }>> {
    if (opts.candidateIds && opts.candidateIds.length === 0) return [];
    const lit = toVectorLiteral(vector);
    const rows = await this.dbs.db.execute<{ entity_id: string; sim: number }>(sql`
      select entity_id, 1 - (embedding <=> ${lit}::vector) as sim
        from ai.embeddings
       where entity_type = ${entityType} and model = ${this.provider.model}
         ${opts.candidateIds ? sql`and entity_id = any(${param(opts.candidateIds)}::uuid[])` : sql``}
       order by embedding <=> ${lit}::vector
       limit ${opts.limit ?? 5}`);
    return [...rows].map((r) => ({ entity_id: r.entity_id, similarity: Math.round(Number(r.sim) * 10_000) / 10_000 })).filter((r) => r.similarity >= (opts.minSimilarity ?? -1));
  }
}
