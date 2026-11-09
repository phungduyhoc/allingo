'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tutorReplySchema } from '@allingo/schemas/api/core';
import { aiErrorToApiError, toAiStreamError, type AiStreamError } from '@/lib/ai-stream';
import { handleExamLockedError } from '@/lib/exam-lock';
import { createThread, getThread, listOlderMessages, sendThreadMessage } from '@/lib/learning-api';
import { notifyApiError } from '@/lib/api-error-events';
import { queryKeys } from '@/lib/queries';
import { chatReducer, initialChat, tutorSseToAction, type Turns } from './chat-state';
import { useProgram } from '@/features/program/program-context';

export const THREADS_KEY = ['ai', 'threads'] as const;

/** Ngữ cảnh tạo hội thoại mới: câu đang xem (+ attempt chứa câu) | attempt | tự do */
export interface TutorContext {
  attemptId?: string;
  questionVersionId?: string;
  /** Nhãn hiển thị (vd. "Câu 12") */
  label?: string;
  /** Gợi ý câu hỏi theo ngữ cảnh (vd. "Vì sao B sai?") */
  suggestions?: string[];
}

export const isFreeContext = (c: TutorContext | null | undefined) => !c || (!c.attemptId && !c.questionVersionId);

function contextBody(c: TutorContext | null) {
  if (isFreeContext(c)) return { kind: 'free' as const };
  return {
    ...(c!.attemptId ? { attempt_id: c!.attemptId } : {}),
    ...(c!.questionVersionId ? { question_version_id: c!.questionVersionId } : {}),
  };
}

/**
 * Hội thoại gia sư: mở thread cũ (GET /ai/threads/{id}), tạo thread khi gửi tin đầu tiên (POST /ai/threads – không tạo
 * thread rỗng), gửi tin → SSE, tải tin cũ hơn theo cursor. 403 `exam_mode_locked` → khoá Exam Mode toàn cục;
 * 429 → toast hạn mức chung (+ thông báo trong panel); kết thúc lượt → làm mới danh sách thread + entitlements.
 */
export function useTutorChat() {
  const qc = useQueryClient();
  // C1: luồng gia sư gắn chương trình hiện hành (ref – callback gửi không phụ thuộc render)
  const program = useProgram();
  const programRef = React.useRef<string>(program);
  React.useEffect(() => {
    programRef.current = program;
  }, [program]);
  const [state, dispatch] = React.useReducer(chatReducer, null, () => initialChat());
  const contextRef = React.useRef<TutorContext | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  // Giá trị dùng trong callback bất đồng bộ (cập nhật cùng lúc dispatch – không chờ render)
  const threadIdRef = React.useRef<string | null>(null);
  const cursorRef = React.useRef<string | null>(null);
  const lastInputRef = React.useRef<string | null>(null);
  const busyRef = React.useRef(false);

  const abort = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  // Đổi thread/huỷ giữa chừng: luồng cũ bị abort → nhả busy để gửi được ở thread mới
  const startNew = React.useCallback((context: TutorContext | null, turns?: Turns | null) => {
    abort();
    contextRef.current = context;
    threadIdRef.current = null;
    cursorRef.current = null;
    busyRef.current = false;
    dispatch({ type: 'reset', turns: turns ?? null });
  }, []);

  const open = React.useCallback(async (threadId: string) => {
    abort();
    const ac = new AbortController();
    abortRef.current = ac;
    threadIdRef.current = threadId;
    cursorRef.current = null;
    busyRef.current = false;
    dispatch({ type: 'loading', threadId });
    try {
      const detail = await getThread(threadId);
      if (ac.signal.aborted) return;
      cursorRef.current = detail.next_cursor;
      dispatch({ type: 'loaded', detail });
    } catch (err) {
      if (ac.signal.aborted) return;
      handleExamLockedError(err);
      const e = toAiStreamError(err);
      if (e) dispatch({ type: 'loadFailed', error: e });
    }
  }, []);

  const loadOlder = React.useCallback(async () => {
    const threadId = threadIdRef.current;
    const cursor = cursorRef.current;
    if (!threadId || !cursor) return;
    try {
      const page = await listOlderMessages(threadId, cursor);
      if (threadIdRef.current !== threadId) return;
      cursorRef.current = page.next_cursor;
      dispatch({ type: 'prepend', messages: page.data, nextCursor: page.next_cursor });
    } catch (err) {
      handleExamLockedError(err);
    }
  }, []);

  const failWith = (e: AiStreamError) => {
    dispatch({ type: 'fail', error: e });
    const apiErr = aiErrorToApiError(e);
    handleExamLockedError(apiErr);
    // 429 hạn mức/giới hạn tốc độ → toast chung; S11: 503 kill-switch ff.ai.tutor → toast + tắt cờ (ẩn lối vào gia sư)
    if (e.status === 429 || e.status === 503) notifyApiError(apiErr);
  };

  const send = React.useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      abort();
      const ac = new AbortController();
      abortRef.current = ac;
      lastInputRef.current = text;
      dispatch({ type: 'send', text });
      let threadId = threadIdRef.current;
      let sent = false;
      try {
        if (!threadId) {
          const thread = await createThread({
            program: programRef.current,
            context: contextBody(contextRef.current),
            title: text.slice(0, 80),
          });
          if (ac.signal.aborted) return;
          threadId = thread.id;
          threadIdRef.current = threadId;
          dispatch({ type: 'threadCreated', threadId, turns: thread.turns ?? null });
        }
        const res = await sendThreadMessage(threadId, text, ac.signal);
        sent = true;
        if (res.kind === 'json') {
          // Không theo spec (luôn SSE) – vẫn chấp nhận TutorReply JSON
          const raw = res.data as { data?: unknown; ai_task_id?: string | null };
          const parsed = tutorReplySchema.safeParse(raw.data ?? raw);
          if (parsed.success) dispatch({ type: 'result', reply: parsed.data, aiTaskId: raw.ai_task_id ?? null });
          else
            dispatch({ type: 'streamError', error: { code: 'ai_failed', status: null, message: 'Invalid AI output' } });
          return;
        }
        let finished = false;
        for await (const ev of res.events) {
          if (ac.signal.aborted) return;
          const action = tutorSseToAction(ev);
          if (!action) continue;
          dispatch(action);
          if (action.type === 'done') {
            finished = true;
            break;
          }
        }
        if (!finished && !ac.signal.aborted) dispatch({ type: 'done' });
      } catch (err) {
        if (ac.signal.aborted) return;
        const e = toAiStreamError(err);
        if (!e) return;
        if (sent) dispatch({ type: 'streamError', error: e });
        else failWith(e);
      } finally {
        if (abortRef.current === ac) busyRef.current = false;
        if (!ac.signal.aborted) {
          void qc.invalidateQueries({ queryKey: THREADS_KEY });
          void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
        }
      }
    },
    [qc],
  );

  const retry = React.useCallback(() => {
    const text = lastInputRef.current;
    if (!text || busyRef.current) return;
    dispatch({ type: 'dropFailed' });
    void send(text);
  }, [send]);

  React.useEffect(() => () => abort(), []);

  return { state, open, startNew, send, retry, loadOlder, context: contextRef };
}
