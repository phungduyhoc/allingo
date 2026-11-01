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

/** Chuỗi lỗi an toàn để hiển thị trong admin */
export function describeError(err: unknown): string {
  if (err instanceof InternalApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
