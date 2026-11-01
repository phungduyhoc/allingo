import { sql } from 'drizzle-orm';
import type { Db } from '@allingo/db';
import type { QuestionSearchDoc } from './question-doc.js';
import type { QuestionSearchFilter, SearchHit, SearchProvider } from './search-provider.js';

/**
 * Tìm kiếm bằng PostgreSQL trực tiếp trên catalog (bản hiện hành của câu đã phát hành): ILIKE + pg_trgm word_similarity.
 * Không cần chỉ mục riêng nên upsert/remove là no-op. Dùng ở dev/test và làm dự phòng khi Meilisearch không sẵn sàng.
 */
export class PgSearchProvider implements SearchProvider {
  readonly name = 'pg' as const;
  constructor(private readonly db: Db) {}

  healthy(): Promise<boolean> {
    return Promise.resolve(true);
  }
  upsertQuestions(_docs: QuestionSearchDoc[]): Promise<void> {
    return Promise.resolve();
  }
  removeQuestions(_ids: string[]): Promise<void> {
    return Promise.resolve();
  }
  resetQuestions(): Promise<void> {
    return Promise.resolve();
  }

  async searchQuestions(q: string, filter: QuestionSearchFilter, limit: number): Promise<SearchHit[]> {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const rows = await this.db.execute<{ id: string; score: number }>(sql`
      select q.id, greatest(word_similarity(${q}, coalesce(v.content ->> 'stem', '')), case when (v.content ->> 'stem') ilike ${like} then 1 else 0 end) as score
      from catalog.questions q
      join catalog.question_versions v on v.id = q.current_version_id
      join catalog.sections s on s.id = q.section_id
      left join catalog.topics t on t.id = q.topic_id
      left join catalog.passages p on p.id = q.passage_id
      where q.status = 'published'
        and q.program_code = ${filter.program}
        ${filter.section_code ? sql`and s.code = ${filter.section_code}` : sql``}
        ${filter.question_type ? sql`and q.question_type_code = ${filter.question_type}` : sql``}
        ${filter.topic ? sql`and t.code = ${filter.topic}` : sql``}
        and ((v.content ->> 'stem') ilike ${like} or coalesce(p.body, '') ilike ${like} or ${q} <% coalesce(v.content ->> 'stem', ''))
      order by score desc, q.id
      limit ${limit}`);
    return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
  }
}
