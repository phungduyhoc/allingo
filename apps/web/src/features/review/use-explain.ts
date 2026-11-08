'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { explanationSchema } from '@allingo/schemas';
import { postJsonOrStream } from '@/lib/api';
import { aiErrorToApiError, aiStreamReducer, consumeAiResponse, initialAiStream, toAiStreamError, type AiStreamState } from '@/lib/ai-stream';
import { notifyApiError } from '@/lib/api-error-events';
import { queryKeys } from '@/lib/queries';
import type { ExplainInput, Explanation } from '@/lib/types';

export type ExplainState = AiStreamState<Explanation>;

/** Trường văn bản hiện dần khi đang stream (thứ tự trong JSON do model quyết định) */
export const EXPLAIN_PREVIEW_FIELDS = ['why_correct', 'chosen_option_trap', 'why_others_wrong', 'how_to_spot'] as const;

const parseExplanation = (d: unknown): Explanation | null => {
  const r = explanationSchema.safeParse(d);
  return r.success ? r.data : null;
};

/**
 * POST /ai/explain (v1.1 – S5): cache hit → JSON (cached: true, có ai_task_id) hiện ngay; sinh mới → SSE start → delta* →
 * result → done; lỗi AI → error (quota đã hoàn). Kết quả validate bằng Zod trước khi hiển thị. Sinh mới thành công hoặc 429
 * → làm mới /me/entitlements (thanh "Còn x lượt"); 429 → toast chung.
 */
export function useExplain(initial?: Explanation | null) {
  const qc = useQueryClient();
  const [state, dispatch] = React.useReducer(aiStreamReducer<Explanation>, initial ?? null, (init) => initialAiStream<Explanation>(init ? { data: init, aiTaskId: init.ai_task_id, cached: true } : null));
  const abortRef = React.useRef<AbortController | null>(null);

  const run = React.useCallback(
    async (input: ExplainInput) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      dispatch({ type: 'request' });
      let generated = false;
      try {
        const res = await postJsonOrStream('/ai/explain', input, ac.signal);
        generated = res.kind === 'sse';
        await consumeAiResponse(res, parseExplanation, dispatch, ac.signal);
      } catch (err) {
        const e = toAiStreamError(err);
        if (!e || ac.signal.aborted) return;
        dispatch({ type: 'error', error: e });
        // 429 hạn mức/giới hạn tốc độ → toast chung; S11: 503 kill-switch → toast + tắt cờ ff.ai.explain ngay (ẩn nút)
        if (e.status === 429 || e.status === 503) notifyApiError(aiErrorToApiError(e));
      } finally {
        if (generated && !ac.signal.aborted) void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
      }
    },
    [qc],
  );

  /**
   * ai_task_id để đánh giá: giải thích kèm trong Review có ai_task_id = null → gọi lại /ai/explain (trúng cache: JSON,
   * không trừ quota/credit) để lấy ai_task_id của chính người học.
   */
  const resolveTaskId = React.useCallback(
    async (input: ExplainInput): Promise<string | null> => {
      if (state.aiTaskId) return state.aiTaskId;
      const res = await postJsonOrStream('/ai/explain', input);
      let id: string | null = null;
      await consumeAiResponse(res, parseExplanation, (a) => {
        if ((a.type === 'loaded' || a.type === 'result' || a.type === 'start') && a.aiTaskId) id = a.aiTaskId;
        if (a.type === 'loaded' || a.type === 'result') dispatch(a.type === 'loaded' ? a : { ...a, type: 'loaded' });
      });
      return id;
    },
    [state.aiTaskId],
  );

  React.useEffect(() => () => abortRef.current?.abort(), []);

  return { state, run, resolveTaskId };
}
