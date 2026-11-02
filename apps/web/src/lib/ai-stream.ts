import { ApiError, type SseEvent } from '@allingo/api-client';

/**
 * Luồng AI qua SSE (Sprint 5) dùng chung cho `POST /ai/explain` và `POST /attempts/{id}/diagnosis`:
 * `start {ai_task_id, cached}` → `delta {text}`* → `result {data, ai_task_id, cached}` → `done`; lỗi AI → `error {code}` → `done`.
 * Trúng cache có thể trả JSON thẳng (explain) hoặc `start{cached:true}` → `result` → `done` (diagnosis).
 * Tệp này chỉ gồm hàm thuần (parser sự kiện, reducer trạng thái, trích chữ từ JSON đang stream) để test bằng Vitest.
 */

export interface AiStreamError {
  /** Mã trong envelope API (`quota_exceeded`, `exam_mode_locked`…) hoặc mã sự kiện `error` (`ai_failed`, `ai_timeout`) */
  code: string;
  /** HTTP status khi lỗi đến từ phản hồi HTTP; null khi lỗi nằm trong luồng SSE */
  status: number | null;
  message?: string;
  details?: Record<string, unknown>;
}

export type AiStreamStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error';

export interface AiStreamState<T> {
  status: AiStreamStatus;
  aiTaskId: string | null;
  cached: boolean;
  /** Văn bản tích luỹ từ `delta` (có thể là mảnh JSON của structured output) */
  text: string;
  data: T | null;
  error: AiStreamError | null;
}

export type AiStreamAction<T> =
  | { type: 'request' }
  | { type: 'start'; aiTaskId: string | null; cached: boolean }
  | { type: 'delta'; text: string }
  | { type: 'result'; data: T; aiTaskId: string | null; cached: boolean }
  | { type: 'error'; error: AiStreamError }
  | { type: 'done' }
  /** Dữ liệu có sẵn (JSON cache hit, GET kết quả đã lưu) */
  | { type: 'loaded'; data: T; aiTaskId: string | null; cached: boolean }
  | { type: 'reset' };

export function initialAiStream<T>(loaded?: { data: T; aiTaskId: string | null; cached: boolean } | null): AiStreamState<T> {
  if (loaded) return { status: 'done', aiTaskId: loaded.aiTaskId, cached: loaded.cached, text: '', data: loaded.data, error: null };
  return { status: 'idle', aiTaskId: null, cached: false, text: '', data: null, error: null };
}

const LIVE: ReadonlySet<AiStreamStatus> = new Set(['connecting', 'streaming']);

/** Lỗi khi luồng kết thúc (`done` hoặc đóng kết nối) mà chưa có `result` */
export const INCOMPLETE_STREAM: AiStreamError = { code: 'ai_failed', status: null, message: 'Stream ended without result' };

export function aiStreamReducer<T>(state: AiStreamState<T>, action: AiStreamAction<T>): AiStreamState<T> {
  switch (action.type) {
    case 'request':
      return { status: 'connecting', aiTaskId: null, cached: false, text: '', data: null, error: null };
    case 'reset':
      return initialAiStream<T>();
    case 'loaded':
      return { status: 'done', aiTaskId: action.aiTaskId, cached: action.cached, text: '', data: action.data, error: null };
    default:
      break;
  }
  // Sự kiện đến sau khi luồng đã kết thúc (done/error) hoặc chưa bắt đầu → bỏ qua
  if (!LIVE.has(state.status)) return state;
  switch (action.type) {
    case 'start':
      return { ...state, status: 'streaming', aiTaskId: action.aiTaskId ?? state.aiTaskId, cached: action.cached };
    case 'delta':
      return action.text ? { ...state, status: 'streaming', text: state.text + action.text } : state;
    case 'result':
      return { ...state, status: 'done', data: action.data, aiTaskId: action.aiTaskId ?? state.aiTaskId, cached: action.cached, error: null };
    case 'error':
      return { ...state, status: 'error', error: action.error, data: null };
    case 'done':
      return { ...state, status: 'error', error: INCOMPLETE_STREAM, data: null };
    default:
      return state;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Sự kiện SSE → action. `parse` validate `result.data` (Zod) – sai dạng → lỗi `ai_failed` (không hiển thị dữ liệu chưa kiểm).
 * Sự kiện lạ (comment, heartbeat, `message`) → null.
 */
export function sseToAction<T>(ev: SseEvent, parse: (data: unknown) => T | null): AiStreamAction<T> | null {
  const d = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
  switch (ev.event) {
    case 'start':
      return { type: 'start', aiTaskId: str(d.ai_task_id), cached: d.cached === true };
    case 'delta':
      return { type: 'delta', text: typeof d.text === 'string' ? d.text : typeof ev.data === 'string' ? ev.data : '' };
    case 'result': {
      const data = parse(d.data);
      if (data === null) return { type: 'error', error: { code: 'ai_failed', status: null, message: 'Invalid AI output' } };
      return { type: 'result', data, aiTaskId: str(d.ai_task_id), cached: d.cached === true };
    }
    case 'error':
      return { type: 'error', error: { code: str(d.code) ?? 'ai_failed', status: null, message: str(d.message) ?? undefined } };
    case 'done':
      return { type: 'done' };
    default:
      return null;
  }
}

/** Lỗi bất kỳ (ApiError của phản hồi HTTP, lỗi mạng) → AiStreamError; AbortError → null (người dùng huỷ/rời trang) */
export function toAiStreamError(err: unknown): AiStreamError | null {
  if (err instanceof DOMException && err.name === 'AbortError') return null;
  if (err instanceof ApiError) return { code: err.code, status: err.status, message: err.message, details: err.details };
  if (err instanceof TypeError) return { code: 'network', status: null, message: err.message };
  return { code: 'internal', status: null, message: err instanceof Error ? err.message : undefined };
}

/** AiStreamError → ApiError (để dùng chung tiện ích lỗi/hạn mức của web) */
export function aiErrorToApiError(e: AiStreamError): ApiError {
  return new ApiError(e.status ?? 0, { error: { code: e.code, message: e.message ?? e.code, details: e.details } });
}

/**
 * Tiêu thụ một phản hồi `postJsonOrSse`: JSON → `loaded`; SSE → từng action. Luồng đóng mà chưa có `done` → `done`
 * (reducer biến thành lỗi nếu chưa có `result`).
 */
export async function consumeAiResponse<T>(
  res: { kind: 'json'; data: unknown } | { kind: 'sse'; events: AsyncIterable<SseEvent> },
  parse: (data: unknown) => T | null,
  dispatch: (a: AiStreamAction<T>) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (res.kind === 'json') {
    const data = parse(res.data);
    if (data === null) {
      dispatch({ type: 'error', error: { code: 'ai_failed', status: null, message: 'Invalid AI output' } });
      return;
    }
    const raw = res.data as { ai_task_id?: unknown; cached?: unknown };
    dispatch({ type: 'loaded', data, aiTaskId: str(raw.ai_task_id), cached: raw.cached !== false });
    return;
  }
  let finished = false;
  for await (const ev of res.events) {
    if (signal?.aborted) return;
    const action = sseToAction(ev, parse);
    if (!action) continue;
    dispatch(action);
    if (action.type === 'done') {
      finished = true;
      break;
    }
  }
  if (!finished && !signal?.aborted) dispatch({ type: 'done' });
}

// ----------------------------------------------------------------------------- Trích chữ từ JSON đang stream

export interface JsonStringPiece {
  /** Đường dẫn khoá kiểu `why_correct`, `steps`, `check_question.stem`, `why_others_wrong.A` (mảng không thêm chỉ số) */
  path: string;
  value: string;
  /** false khi chuỗi đang dở ở cuối buffer */
  complete: boolean;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' };

type Frame = { kind: 'obj'; key: string | null; expectKey: boolean } | { kind: 'arr' };

/**
 * Trích mọi giá trị chuỗi trong một JSON CÓ THỂ CHƯA HOÀN CHỈNH (delta của structured output), theo thứ tự xuất hiện;
 * chuỗi dở ở cuối vẫn trả (complete=false), escape dở (`\`, `\u12`) bị bỏ. Không ném lỗi với đầu vào bất kỳ.
 */
export function extractJsonStrings(raw: string): JsonStringPiece[] {
  const out: JsonStringPiece[] = [];
  const stack: Frame[] = [];
  const path = () =>
    stack
      .map((f) => (f.kind === 'obj' ? f.key : null))
      .filter((k): k is string => !!k)
      .join('.');
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const c = raw[i]!;
    if (c === '"') {
      let j = i + 1;
      let value = '';
      let complete = false;
      while (j < n) {
        const ch = raw[j]!;
        if (ch === '\\') {
          if (j + 1 >= n) {
            j = n;
            break;
          }
          const e = raw[j + 1]!;
          if (e === 'u') {
            const hex = raw.slice(j + 2, j + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              j = n;
              break;
            }
            value += String.fromCharCode(parseInt(hex, 16));
            j += 6;
            continue;
          }
          value += ESCAPES[e] ?? e;
          j += 2;
          continue;
        }
        if (ch === '"') {
          complete = true;
          j++;
          break;
        }
        value += ch;
        j++;
      }
      const top = stack[stack.length - 1];
      if (top?.kind === 'obj' && top.expectKey) {
        if (complete) {
          top.key = value;
          top.expectKey = false;
        }
      } else {
        out.push({ path: path(), value, complete });
      }
      i = j;
      continue;
    }
    if (c === '{') stack.push({ kind: 'obj', key: null, expectKey: true });
    else if (c === '[') stack.push({ kind: 'arr' });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') {
      const top = stack[stack.length - 1];
      if (top?.kind === 'obj') {
        top.expectKey = true;
        top.key = null;
      }
    }
    i++;
  }
  return out;
}

export interface StreamPreview {
  /** `text`: provider stream văn xuôi → hiện nguyên; `json`: trích các trường văn bản từ JSON đang sinh */
  kind: 'text' | 'json';
  text: string;
}

/**
 * Chữ hiển thị dần khi đang stream: văn xuôi giữ nguyên; JSON (kể cả bọc ```json) → nối các giá trị chuỗi có đường dẫn
 * bắt đầu bằng một trong `fields` (theo thứ tự xuất hiện), mỗi giá trị một dòng.
 */
export function streamPreview(raw: string, fields: readonly string[]): StreamPreview {
  const trimmed = raw.trimStart();
  const body = trimmed.startsWith('```') ? trimmed.slice(trimmed.indexOf('\n') + 1 || trimmed.length) : trimmed;
  if (!body) return { kind: trimmed.startsWith('```') ? 'json' : 'text', text: '' };
  if (body[0] !== '{' && body[0] !== '[') return { kind: 'text', text: raw };
  const allowed = (p: string) => fields.some((f) => p === f || p.startsWith(`${f}.`));
  const text = extractJsonStrings(body)
    .filter((s) => s.value.trim().length > 0 && allowed(s.path))
    .map((s) => s.value)
    .join('\n');
  return { kind: 'json', text };
}
