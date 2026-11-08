import { tutorReplySchema, type Message, type RefusalCode, type ThreadDetail, type TutorCitation, type TutorReply } from '@allingo/schemas/api/core';
import type { SseEvent } from '@allingo/api-client';
import { INCOMPLETE_STREAM, sseToAction, type AiStreamError } from '@/lib/ai-stream';

/**
 * Trạng thái hội thoại gia sư (thuần – có test). Luồng gửi tin: `send` (thêm tin người học + chỗ trống cho trả lời) →
 * `start` → `delta`* (văn bản thuần – mảnh của reply_markdown) → `result` (TutorReply chuẩn: thay toàn bộ chữ đã stream,
 * đổi id tạm thành id server, cập nhật lượt) → `done`. Lỗi HTTP trước stream (`fail`) → bỏ chỗ trống, tin người học
 * đánh dấu lỗi để gửi lại; lỗi trong luồng (`error` / đóng khi chưa có `result`) → bong bóng trả lời báo lỗi.
 */

export type ChatRole = 'user' | 'assistant';
export type ChatMessageStatus = 'done' | 'pending' | 'streaming' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  status: ChatMessageStatus;
  aiTaskId: string | null;
  refused: boolean;
  refusalCode: RefusalCode | null;
  suggestedFollowups: string[];
  citations: TutorCitation[];
  /** Mã lỗi khi status = error (ai_failed, ai_timeout, network…) */
  errorCode?: string;
  errorMessage?: string;
}

export interface Turns {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export type ChatStatus = 'idle' | 'loading' | 'connecting' | 'streaming' | 'error';

export interface ChatState {
  threadId: string | null;
  messages: ChatMessage[];
  /** Cursor tải tin cũ hơn (null = hết) */
  olderCursor: string | null;
  status: ChatStatus;
  /** Lỗi gửi gần nhất (HTTP trước stream hoặc trong luồng) */
  error: AiStreamError | null;
  turns: Turns | null;
  /** Câu vừa gửi – để "Gửi lại" sau lỗi */
  lastInput: string | null;
  /** Bộ đếm id tạm */
  seq: number;
}

export type ChatAction =
  | { type: 'reset'; threadId?: string | null; turns?: Turns | null }
  | { type: 'loading'; threadId: string }
  | { type: 'loaded'; detail: Pick<ThreadDetail, 'id' | 'messages' | 'next_cursor' | 'turns'> }
  | { type: 'loadFailed'; error: AiStreamError }
  | { type: 'prepend'; messages: Message[]; nextCursor: string | null }
  | { type: 'threadCreated'; threadId: string; turns?: Turns | null }
  | { type: 'send'; text: string; at?: string }
  | { type: 'start'; aiTaskId: string | null }
  | { type: 'delta'; text: string }
  | { type: 'result'; reply: TutorReply; aiTaskId: string | null }
  | { type: 'streamError'; error: AiStreamError }
  /** Lỗi trước khi có luồng (HTTP 4xx/5xx, mạng) */
  | { type: 'fail'; error: AiStreamError }
  | { type: 'done' }
  /** Bỏ cặp tin lỗi cuối (trước khi gửi lại) */
  | { type: 'dropFailed' };

export const initialChat = (threadId: string | null = null): ChatState => ({
  threadId,
  messages: [],
  olderCursor: null,
  status: 'idle',
  error: null,
  turns: null,
  lastInput: null,
  seq: 0,
});

const LOCAL_PREFIX = 'local-';
export const isLocalId = (id: string) => id.startsWith(LOCAL_PREFIX);

/** Message của API → ChatMessage (tin "system" bỏ qua) */
export function fromApiMessage(m: Message): ChatMessage | null {
  if (m.role !== 'user' && m.role !== 'assistant') return null;
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    createdAt: m.created_at,
    status: 'done',
    aiTaskId: m.ai_task_id,
    refused: !!m.refused,
    refusalCode: m.refusal_code ?? null,
    suggestedFollowups: m.suggested_followups ?? [],
    citations: m.citations ?? [],
  };
}

const mapApi = (xs: readonly Message[]) => xs.map(fromApiMessage).filter((x): x is ChatMessage => x !== null);

const LIVE: ReadonlySet<ChatStatus> = new Set(['connecting', 'streaming']);

function patchPlaceholder(state: ChatState, fn: (m: ChatMessage) => ChatMessage): ChatMessage[] {
  const idx = findLastIndex(
    state.messages,
    (m) => m.role === 'assistant' && isLocalId(m.id) && (m.status === 'streaming' || m.status === 'pending'),
  );
  if (idx < 0) return state.messages;
  const next = state.messages.slice();
  next[idx] = fn(next[idx]!);
  return next;
}

function findLastIndex<T>(xs: readonly T[], pred: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) if (pred(xs[i]!)) return i;
  return -1;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'reset':
      return { ...initialChat(action.threadId ?? null), turns: action.turns ?? null };
    case 'loading':
      return { ...initialChat(action.threadId), status: 'loading' };
    case 'loaded':
      return {
        ...state,
        threadId: action.detail.id,
        messages: mapApi(action.detail.messages),
        olderCursor: action.detail.next_cursor,
        status: 'idle',
        error: null,
        turns: action.detail.turns ?? state.turns,
      };
    case 'loadFailed':
      return { ...state, status: 'error', error: action.error };
    case 'prepend': {
      const known = new Set(state.messages.map((m) => m.id));
      const older = mapApi(action.messages).filter((m) => !known.has(m.id));
      return { ...state, messages: [...older, ...state.messages], olderCursor: action.nextCursor };
    }
    case 'threadCreated':
      return { ...state, threadId: action.threadId, turns: action.turns ?? state.turns };
    case 'send': {
      if (LIVE.has(state.status)) return state;
      const at = action.at ?? new Date().toISOString();
      const seq = state.seq + 1;
      const base = {
        createdAt: at,
        aiTaskId: null,
        refused: false,
        refusalCode: null,
        suggestedFollowups: [],
        citations: [],
      };
      const user: ChatMessage = {
        ...base,
        id: `${LOCAL_PREFIX}u${seq}`,
        role: 'user',
        text: action.text,
        status: 'pending',
      };
      const reply: ChatMessage = {
        ...base,
        id: `${LOCAL_PREFIX}a${seq}`,
        role: 'assistant',
        text: '',
        status: 'pending',
      };
      return {
        ...state,
        messages: [...state.messages, user, reply],
        status: 'connecting',
        error: null,
        lastInput: action.text,
        seq,
      };
    }
    default:
      break;
  }
  if (!LIVE.has(state.status)) return action.type === 'dropFailed' ? dropFailed(state) : state;
  switch (action.type) {
    case 'start':
      return {
        ...state,
        status: 'streaming',
        messages: patchPlaceholder(state, (m) => ({
          ...m,
          status: 'streaming',
          aiTaskId: action.aiTaskId ?? m.aiTaskId,
        })),
      };
    case 'delta':
      if (!action.text) return state;
      return {
        ...state,
        status: 'streaming',
        messages: patchPlaceholder(state, (m) => ({ ...m, status: 'streaming', text: m.text + action.text })),
      };
    case 'result': {
      const r = action.reply;
      const messages = state.messages.map((m) => {
        if (m.role === 'user' && isLocalId(m.id) && m.status === 'pending')
          return { ...m, id: r.user_message_id, status: 'done' as const };
        if (m.role === 'assistant' && isLocalId(m.id) && (m.status === 'streaming' || m.status === 'pending'))
          return {
            ...m,
            id: r.message_id,
            text: r.reply_markdown,
            status: 'done' as const,
            aiTaskId: action.aiTaskId ?? m.aiTaskId,
            refused: r.refused,
            refusalCode: r.refusal_code,
            suggestedFollowups: r.suggested_followups,
            citations: r.citations,
          };
        return m;
      });
      return { ...state, messages, status: 'idle', error: null, turns: r.turns, lastInput: null };
    }
    case 'streamError':
      return streamFailed(state, action.error);
    case 'done':
      // Đóng luồng khi chưa có result → lỗi (reducer sau result đã về idle nên không vào đây)
      return streamFailed(state, INCOMPLETE_STREAM);
    case 'fail': {
      // Chưa có luồng: bỏ chỗ trống trả lời, tin người học đánh dấu lỗi (giữ chữ để gửi lại)
      const messages = state.messages
        .filter((m) => !(m.role === 'assistant' && isLocalId(m.id) && m.status !== 'done'))
        .map((m) =>
          m.role === 'user' && isLocalId(m.id) && m.status === 'pending'
            ? { ...m, status: 'error' as const, errorCode: action.error.code }
            : m,
        );
      return { ...state, messages, status: 'error', error: action.error };
    }
    case 'dropFailed':
      return dropFailed(state);
    default:
      return state;
  }
}

function streamFailed(state: ChatState, error: AiStreamError): ChatState {
  const messages = state.messages.map((m) => {
    if (m.role === 'user' && isLocalId(m.id) && m.status === 'pending') return { ...m, status: 'done' as const };
    if (m.role === 'assistant' && isLocalId(m.id) && (m.status === 'streaming' || m.status === 'pending'))
      return { ...m, status: 'error' as const, errorCode: error.code, errorMessage: error.message };
    return m;
  });
  return { ...state, messages, status: 'error', error };
}

function dropFailed(state: ChatState): ChatState {
  // Bỏ tin người học lỗi (chưa tới server) và bong bóng trả lời lỗi cuối cùng (kèm tin người học ngay trước nó)
  let messages = state.messages.filter((m) => !(m.role === 'user' && m.status === 'error'));
  const lastErr = findLastIndex(messages, (m) => m.role === 'assistant' && m.status === 'error');
  if (lastErr >= 0) {
    const prev = messages[lastErr - 1];
    messages = messages.filter((_, i) => i !== lastErr && !(i === lastErr - 1 && prev?.role === 'user'));
  }
  return { ...state, messages, status: 'idle', error: null };
}

/** Sự kiện SSE của gia sư → action (dùng parser chung của ai-stream; `result.data` validate bằng Zod TutorReply) */
export function tutorSseToAction(ev: SseEvent): ChatAction | null {
  const a = sseToAction<TutorReply>(ev, (d) => {
    const r = tutorReplySchema.safeParse(d);
    return r.success ? r.data : null;
  });
  if (!a) return null;
  switch (a.type) {
    case 'start':
      return { type: 'start', aiTaskId: a.aiTaskId };
    case 'delta':
      return { type: 'delta', text: a.text };
    case 'result':
      return { type: 'result', reply: a.data, aiTaskId: a.aiTaskId };
    case 'error':
      return { type: 'streamError', error: a.error };
    case 'done':
      return { type: 'done' };
    default:
      return null;
  }
}

/** Gợi ý câu hỏi: gợi ý theo ngữ cảnh + `suggested_followups` của câu trả lời cuối (không trùng, tối đa `max`) */
export function mergeSuggestions(base: readonly string[], followups: readonly string[], max = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...followups, ...base]) {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
    if (out.length >= max) break;
  }
  return out;
}

/** Lượt còn lại cho bộ đếm (null = không giới hạn/không rõ) */
export function turnsRemaining(t: Turns | null): number | null {
  if (!t || t.limit === null) return null;
  return t.remaining ?? Math.max(0, t.limit - t.used);
}

export const lastAssistant = (s: ChatState): ChatMessage | null => {
  const i = findLastIndex(s.messages, (m) => m.role === 'assistant' && m.status === 'done');
  return i >= 0 ? s.messages[i]! : null;
};
