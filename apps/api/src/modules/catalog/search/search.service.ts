import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { ENV, type Env } from '../../../config/env.js';
import { DbService } from '../../../shared/db/db.module.js';
import type { OutboxEvent } from '../../../shared/events/outbox.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { buildQuestionDoc, type QuestionSearchDoc } from './question-doc.js';
import { MeiliSearchProvider } from './meili.provider.js';
import { PgSearchProvider } from './pg.provider.js';
import type { QuestionSearchFilter, SearchHit, SearchProvider } from './search-provider.js';

const { catalogQuestions, catalogQuestionVersions, catalogSections, catalogTopics, catalogPassages } = schema;

/**
 * Tìm kiếm nội dung (Sprint 2): outbox `content.published` → index câu ĐÃ PHÁT HÀNH (bản hiện hành, không đáp án);
 * `content.retired` → xoá. SEARCH_PROVIDER=auto: dùng Meilisearch khi sẵn sàng (kiểm tra mỗi 60 s), nếu không PostgreSQL.
 */
@Injectable()
export class SearchService {
  private readonly logger = getLogger({ component: 'catalog.search' });
  private readonly meili: MeiliSearchProvider | null;
  private readonly pg: PgSearchProvider;
  private meiliOk: { value: boolean; at: number } = { value: false, at: 0 };

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
  ) {
    this.pg = new PgSearchProvider(dbs.db);
    this.meili = env.SEARCH_PROVIDER === 'pg' ? null : new MeiliSearchProvider(env.MEILISEARCH_HOST, env.MEILISEARCH_API_KEY, env.SEARCH_INDEX_PREFIX);
  }

  /** Provider đang dùng cho truy vấn */
  async provider(): Promise<SearchProvider> {
    if (!this.meili) return this.pg;
    if (this.env.SEARCH_PROVIDER === 'meili') return this.meili;
    if (Date.now() - this.meiliOk.at > 60_000) this.meiliOk = { value: await this.meili.healthy(), at: Date.now() };
    return this.meiliOk.value ? this.meili : this.pg;
  }

  /** Dựng tài liệu index cho các câu đã phát hành (bản hiện hành) */
  async buildDocs(questionIds?: string[]): Promise<QuestionSearchDoc[]> {
    const rows = await this.dbs.db
      .select({ q: catalogQuestions, v: catalogQuestionVersions, section: catalogSections.code, topic: catalogTopics.code, passage: catalogPassages.body })
      .from(catalogQuestions)
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogQuestions.sectionId))
      .leftJoin(catalogTopics, eq(catalogTopics.id, catalogQuestions.topicId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .where(and(eq(catalogQuestions.status, 'published'), questionIds ? inArray(catalogQuestions.id, questionIds) : undefined));
    return rows.map((r) =>
      buildQuestionDoc({
        question_id: r.q.id,
        version_id: r.v.id,
        program: r.q.programCode,
        section_code: r.section,
        question_type: r.q.questionTypeCode,
        topic: r.topic ?? null,
        difficulty: r.q.difficultyTarget ?? null,
        content: r.v.content,
        passage_body: r.passage ?? null,
        published_at: ((r.v.metadata as { published_at?: string | null }).published_at ?? r.q.updatedAt),
      }),
    );
  }

  async indexQuestions(ids: string[]): Promise<number> {
    if (!this.meili) return 0;
    const docs = await this.buildDocs(ids);
    const live = new Set(docs.map((d) => d.id));
    await this.meili.upsertQuestions(docs);
    // Câu không còn published (bị gỡ/thu hồi) → xoá khỏi index
    const gone = ids.filter((id) => !live.has(id));
    if (gone.length) await this.meili.removeQuestions(gone);
    return docs.length;
  }

  /** Dựng lại toàn bộ index (script `pnpm --filter @allingo/api search:reindex`) */
  async reindexAll(): Promise<number> {
    if (!this.meili) return 0;
    const docs = await this.buildDocs();
    await this.meili.resetQuestions();
    for (let i = 0; i < docs.length; i += 500) await this.meili.upsertQuestions(docs.slice(i, i + 500));
    return docs.length;
  }

  async searchQuestions(q: string, filter: QuestionSearchFilter, limit = 50): Promise<SearchHit[]> {
    const p = await this.provider();
    try {
      return await p.searchQuestions(q, filter, limit);
    } catch (err) {
      if (p.name === 'pg') throw err;
      this.logger.warn({ err: (err as Error).message }, 'meilisearch query failed → fallback pg');
      this.meiliOk = { value: false, at: Date.now() };
      return this.pg.searchQuestions(q, filter, limit);
    }
  }

  // ------------------------------------------------------------- consumer outbox (worker)
  @OnEvent('outbox.content.published')
  async onPublished(ev: OutboxEvent<{ entity?: string; question_id?: string }>): Promise<void> {
    if (ev.payload.entity !== 'question' || !ev.payload.question_id) return;
    await this.safeIndex([ev.payload.question_id]);
  }

  @OnEvent('outbox.content.retired')
  async onRetired(ev: OutboxEvent<{ entity?: string; question_id?: string }>): Promise<void> {
    if (ev.payload.entity !== 'question' || !ev.payload.question_id) return;
    await this.safeIndex([ev.payload.question_id]);
  }

  private async safeIndex(ids: string[]): Promise<void> {
    if (!this.meili) return;
    try {
      if (!(await this.meili.healthy())) {
        this.logger.warn({ ids: ids.length }, 'meilisearch unavailable – skip indexing (reindex later)');
        return;
      }
      await this.indexQuestions(ids);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'search indexing failed');
    }
  }
}
