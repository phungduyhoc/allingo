import type { LocalizedText, QuestionContent } from '@allingo/schemas';
import { getEnv } from './env';
import type { RawReferenceData } from './reference';

/**
 * Client gọi API nội bộ của apps/api (ADR-0019): CMS không ghi trực tiếp vào catalog.*,
 * mọi phát hành/kiểm tra AI đi qua các endpoint `/internal/content/*` với header `X-Internal-Token`.
 * API có thể chưa chạy lúc soạn thảo → ném `InternalApiError` với thông điệp thân thiện, không crash admin.
 */

export type AiCheckVerdict = 'pass' | 'fail' | 'needs_change';

export interface CheckQuestionRequest {
  program: string;
  section_code: string;
  content: QuestionContent;
}
export interface CheckQuestionResponse {
  verdict: AiCheckVerdict;
  issues: Array<{ field?: string; severity: 'error' | 'warning'; message: string }>;
  ai_task_id: string | null;
  /** Báo cáo đầy đủ của task check_question (unique_answer, key_correct, difficulty_estimate...) – API trả thêm, giữ nguyên để reviewer xem */
  report?: Record<string, unknown>;
}

export interface PublishQuestionRequest {
  external_ref: string;
  program: string;
  section_code: string;
  question_type: string;
  content: QuestionContent;
  difficulty?: string;
  topic_code?: string;
  subskill_codes?: string[];
  source: 'human' | 'ai';
  change_note?: string;
  created_by_email?: string;
  /** B5: passage của câu (id catalog = id passage CMS – đồng bộ trước bằng syncPassage); null = bỏ liên kết */
  passage_id?: string | null;
}
export interface PublishQuestionResponse {
  question_id: string;
  question_version_id: string;
  version_no: number;
  status?: string;
  changed?: boolean;
}

/** Đồng bộ câu hỏi + trạng thái + quyết định duyệt sang catalog (ADR-0024) */
export interface SyncQuestionRequest extends PublishQuestionRequest {
  status: string;
  review?: { stage: 'ai_check' | 'review1' | 'review2'; decision: string; notes?: string | null; reviewer_email?: string | null; ai_report?: Record<string, unknown> | null } | null;
}

export interface DuplicatesResponse {
  threshold: number;
  in_batch: Array<{ index: number; duplicate_of: number; similarity: number }>;
  existing: Array<{ index: number; question_id: string; similarity: number; status: string }>;
}

export interface StructureReportResponse {
  ok: boolean;
  total: number;
  by_section: Record<string, number>;
  issues: Array<{ code: string; section?: string; message: string; expected?: number; actual?: number }>;
}

export interface PublishTestSetRequest {
  external_ref: string;
  program: string;
  code: string;
  title: LocalizedText;
  kind: 'full' | 'mini' | 'part_drill' | 'diagnostic' | 'topic_pack';
  is_free: boolean;
  duration_sec: number | null;
  sections: Array<{ section_code: string; duration_sec: number | null }>;
  items: Array<{ question_external_ref: string; section_code: string; sort_order: number; group_key?: string | null; points?: number }>;
}
export interface PublishTestSetResponse {
  test_set_id: string;
}

export class InternalApiError extends Error {
  readonly kind: 'unreachable' | 'timeout' | 'http' | 'invalid_response';
  readonly status: number | undefined;
  constructor(kind: InternalApiError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'InternalApiError';
    this.kind = kind;
    this.status = status;
  }
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

function describeApiFailure(err: unknown): InternalApiError {
  if (err instanceof InternalApiError) return err;
  if (err instanceof Error && err.name === 'AbortError') {
    return new InternalApiError('timeout', 'API nội bộ không phản hồi kịp (timeout). Thử lại sau.');
  }
  const cause = err instanceof Error && 'cause' in err ? (err as { cause?: { code?: string } }).cause : undefined;
  const code = cause?.code ?? '';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'EAI_AGAIN') {
    return new InternalApiError('unreachable', `Không kết nối được API nội bộ (${code}). Hãy chạy apps/api (pnpm dev) rồi thử lại.`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new InternalApiError('unreachable', `Không gọi được API nội bộ: ${msg}`);
}

async function request<T>(opts: RequestOptions): Promise<T> {
  const env = getEnv();
  const url = `${env.INTERNAL_API_URL.replace(/\/$/, '')}${opts.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? env.INTERNAL_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Internal-Token': env.INTERNAL_API_TOKEN,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) throw new InternalApiError('invalid_response', 'API nội bộ trả dữ liệu không phải JSON.', res.status);
      }
    }
    if (!res.ok) {
      const envelope = json as { error?: { code?: string; message?: string; details?: { issues?: Array<{ message?: string }> } } } | null;
      const issues = (envelope?.error?.details?.issues ?? []).map((i) => i.message).filter(Boolean).slice(0, 5);
      const message = `${envelope?.error?.message ?? `HTTP ${res.status}`}${issues.length ? ` – ${issues.join('; ')}` : ''}`;
      const code = envelope?.error?.code ? ` [${envelope.error.code}]` : '';
      throw new InternalApiError('http', `API nội bộ từ chối${code}: ${message}`, res.status);
    }
    return json as T;
  } catch (err) {
    throw describeApiFailure(err);
  } finally {
    clearTimeout(timer);
  }
}

/** POST /internal/content/questions/check – gọi task `check_question` qua AI Gateway (mock ở dev) */
export function checkQuestion(body: CheckQuestionRequest): Promise<CheckQuestionResponse> {
  return request<CheckQuestionResponse>({ method: 'POST', path: '/internal/content/questions/check', body, timeoutMs: 60_000 });
}

/** POST /internal/content/questions/publish – idempotent theo external_ref; nội dung đổi → version mới */
export function publishQuestion(body: PublishQuestionRequest): Promise<PublishQuestionResponse> {
  return request<PublishQuestionResponse>({ method: 'POST', path: '/internal/content/questions/publish', body });
}

/** POST /internal/content/questions/sync – mỗi lần lưu/chuyển trạng thái (catalog là nguồn sự thật vòng đời) */
export function syncQuestion(body: SyncQuestionRequest): Promise<PublishQuestionResponse> {
  return request<PublishQuestionResponse>({ method: 'POST', path: '/internal/content/questions/sync', body });
}

/** POST /internal/content/questions/duplicates – trùng trong lô + với catalog (pg_trgm ≥ 0,85) */
export function findDuplicates(body: { program: string; stems: string[]; threshold?: number; exclude_external_refs?: string[] }): Promise<DuplicatesResponse> {
  return request<DuplicatesResponse>({ method: 'POST', path: '/internal/content/questions/duplicates', body, timeoutMs: 30_000 });
}

/** B5: passage + văn bản từng phần (bộ đôi/bộ ba Part 7) → catalog.passages + passage_parts (id catalog = id CMS) */
export interface SyncPassageRequest {
  passage_id: string;
  program: string;
  kind: 'reading_passage' | 'audio_script' | 'image_prompt' | 'chart_prompt' | 'dialogue';
  title?: string | null;
  body?: string | null;
  difficulty?: string | null;
  status: 'draft' | 'ready' | 'retired';
  parts: Array<{ title?: string | null; body: string }>;
}
export function syncPassage(body: SyncPassageRequest): Promise<{ passage_id: string; parts: number; status: string }> {
  return request<{ passage_id: string; parts: number; status: string }>({ method: 'POST', path: '/internal/content/passages/sync', body });
}

/** POST /internal/content/test-sets/validate – kiểm tra cấu trúc (TOEIC full: Part 1–7 đúng số câu) */
export function validateTestSet(body: Pick<PublishTestSetRequest, 'program' | 'kind' | 'items'>): Promise<StructureReportResponse> {
  return request<StructureReportResponse>({ method: 'POST', path: '/internal/content/test-sets/validate', body });
}

/** POST /internal/content/test-sets/publish */
export function publishTestSet(body: PublishTestSetRequest): Promise<PublishTestSetResponse> {
  return request<PublishTestSetResponse>({ method: 'POST', path: '/internal/content/test-sets/publish', body });
}

/** GET /internal/content/reference – danh mục cho dropdown (dạng thô; chuẩn hoá bằng normalizeReference) */
export function fetchReference(): Promise<RawReferenceData> {
  return request<RawReferenceData>({ method: 'GET', path: '/internal/content/reference', timeoutMs: 5_000 });
}

/** Yêu cầu sinh câu hỏi bằng AI (S5) – `requested_by_email` = apiUserEmail của biên tập viên (vai trò nội dung bên API) */
export interface GenerateQuestionsRequest {
  program: string;
  section: string;
  question_type: string;
  topic?: string;
  difficulty?: string;
  count: number;
  passage_id?: string;
  requested_by_email: string;
}
export interface GeneratedItem {
  index: number;
  status: 'created' | 'invalid';
  question_id: string | null;
  question_version_id: string | null;
  external_ref: string | null;
  workflow_status: string | null;
  verdict: 'pass' | 'needs_change' | 'fail' | null;
  issues: Array<{ field?: string; severity: string; message: string }>;
  ai_check_task_id: string | null;
  duplicate: { flagged: boolean; method: 'embedding' | 'trigram' | 'in_batch' | null; of_question_id: string | null; of_index: number | null; similarity: number | null; embedding_similarity: number | null; trigram_similarity: number | null };
  content: QuestionContent | null;
  errors?: string[];
}
export interface GenerationJobResponse {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  result: { items: GeneratedItem[]; summary: Record<string, unknown> } | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /internal/content/questions/generate → 202 { job_id } (job content.generate: draft source=ai + AI check + cờ trùng) */
export function generateQuestions(body: GenerateQuestionsRequest): Promise<{ job_id: string; status: string; mode: string }> {
  return request<{ job_id: string; status: string; mode: string }>({ method: 'POST', path: '/internal/content/questions/generate', body, timeoutMs: 15_000 });
}

/** GET /internal/content/questions/generate/{jobId} – trạng thái/kết quả */
export function generationStatus(jobId: string): Promise<GenerationJobResponse> {
  return request<GenerationJobResponse>({ method: 'GET', path: `/internal/content/questions/generate/${encodeURIComponent(jobId)}`, timeoutMs: 10_000 });
}

/** Chuỗi lỗi an toàn để hiển thị trong admin */
export function describeError(err: unknown): string {
  if (err instanceof InternalApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ----------------------------------------------------------------------------- S12: báo lỗi câu hỏi (hàng đợi duyệt)
export interface ContentReportItem {
  id: string;
  question_id: string | null;
  question_version_id: string;
  version_no: number | null;
  external_ref: string | null;
  section_code: string | null;
  stem_preview: string | null;
  reason: string;
  message: string | null;
  status: 'open' | 'confirmed' | 'rejected' | 'fixed';
  resolution_note: string | null;
  sla_due_at: string | null;
  overdue: boolean;
  reports_for_question: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/** GET /internal/content-reports?updated_since=&cursor= – kéo thay đổi tăng dần theo updated_at (đồng bộ collection content-reports) */
export function listContentReports(q: { updated_since: string; cursor?: string | null; limit?: number }): Promise<{ data: ContentReportItem[]; next_cursor: string | null }> {
  const params = new URLSearchParams({ updated_since: q.updated_since, limit: String(q.limit ?? 200) });
  if (q.cursor) params.set('cursor', q.cursor);
  return request<{ data: ContentReportItem[]; next_cursor: string | null }>({ method: 'GET', path: `/internal/content-reports?${params.toString()}`, timeoutMs: 10_000 });
}

/** POST /internal/content-reports/{id}/status – xác nhận/từ chối/đã sửa + ghi chú (API ghi audit, báo người học) */
export function setContentReportStatus(id: string, body: { status: ContentReportItem['status']; resolution_note?: string; resolved_by_email?: string }): Promise<ContentReportItem> {
  return request<ContentReportItem>({ method: 'POST', path: `/internal/content-reports/${encodeURIComponent(id)}/status`, body });
}
