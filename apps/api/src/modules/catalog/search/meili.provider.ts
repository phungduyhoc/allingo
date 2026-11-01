import { Meilisearch, type Index } from 'meilisearch';
import type { QuestionSearchDoc } from './question-doc.js';
import type { QuestionSearchFilter, SearchHit, SearchProvider } from './search-provider.js';

const quote = (v: string) => `"${v.replace(/["\\]/g, '')}"`;

/** Meilisearch: index `<prefix>questions` (searchable stem/options/passage/tags; filterable program/section/type/topic) */
export class MeiliSearchProvider implements SearchProvider {
  readonly name = 'meili' as const;
  private readonly client: Meilisearch;
  private settingsApplied = false;

  constructor(
    host: string,
    apiKey: string | undefined,
    private readonly prefix: string,
  ) {
    this.client = new Meilisearch({ host, apiKey, timeout: 3000 });
  }

  private get index(): Index<QuestionSearchDoc> {
    return this.client.index<QuestionSearchDoc>(`${this.prefix}questions`);
  }

  async healthy(): Promise<boolean> {
    try {
      return (await this.client.health()).status === 'available';
    } catch {
      return false;
    }
  }

  private async ensureSettings(): Promise<void> {
    if (this.settingsApplied) return;
    await this.client.createIndex(`${this.prefix}questions`, { primaryKey: 'id' }).waitTask().catch(() => undefined);
    await this.index
      .updateSettings({
        searchableAttributes: ['stem', 'options_text', 'passage_excerpt', 'tags'],
        filterableAttributes: ['program', 'section_code', 'question_type', 'topic', 'difficulty'],
        sortableAttributes: ['published_at'],
        displayedAttributes: ['id', 'version_id', 'program', 'section_code', 'question_type', 'topic', 'difficulty', 'stem'],
      })
      .waitTask();
    this.settingsApplied = true;
  }

  async upsertQuestions(docs: QuestionSearchDoc[]): Promise<void> {
    if (!docs.length) return;
    await this.ensureSettings();
    await this.index.addDocuments(docs).waitTask();
  }

  async removeQuestions(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.index.deleteDocuments(ids).waitTask();
  }

  async resetQuestions(): Promise<void> {
    await this.ensureSettings();
    await this.index.deleteAllDocuments().waitTask();
  }

  async searchQuestions(q: string, filter: QuestionSearchFilter, limit: number): Promise<SearchHit[]> {
    await this.ensureSettings();
    const f = [`program = ${quote(filter.program)}`];
    if (filter.section_code) f.push(`section_code = ${quote(filter.section_code)}`);
    if (filter.question_type) f.push(`question_type = ${quote(filter.question_type)}`);
    if (filter.topic) f.push(`topic = ${quote(filter.topic)}`);
    const res = await this.index.search(q, { filter: f.join(' AND '), limit, showRankingScore: true, attributesToRetrieve: ['id'] });
    return res.hits.map((h) => ({ id: h.id, score: Number((h as { _rankingScore?: number })._rankingScore ?? 0) }));
  }
}
