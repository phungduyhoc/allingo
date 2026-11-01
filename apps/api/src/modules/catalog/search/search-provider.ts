import type { QuestionSearchDoc } from './question-doc.js';

export interface QuestionSearchFilter {
  program: string;
  section_code?: string;
  question_type?: string;
  topic?: string;
}

export interface SearchHit {
  id: string;
  score: number;
}

/** Nhà cung cấp tìm kiếm (ADR-0024): Meilisearch (prod) hoặc PostgreSQL (dev/test, dự phòng khi Meili lỗi) */
export interface SearchProvider {
  readonly name: 'meili' | 'pg';
  healthy(): Promise<boolean>;
  upsertQuestions(docs: QuestionSearchDoc[]): Promise<void>;
  removeQuestions(ids: string[]): Promise<void>;
  searchQuestions(q: string, filter: QuestionSearchFilter, limit: number): Promise<SearchHit[]>;
  /** Xoá toàn bộ chỉ mục câu hỏi (reindex) */
  resetQuestions(): Promise<void>;
}
