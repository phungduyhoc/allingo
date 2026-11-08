'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { attemptAiDiagnosisSchema } from '@allingo/schemas/api/core';
import { postJsonOrStream } from '@/lib/api';
import { aiErrorToApiError, aiStreamReducer, consumeAiResponse, initialAiStream, toAiStreamError, type AiStreamAction, type AiStreamState } from '@/lib/ai-stream';
import { notifyApiError } from '@/lib/api-error-events';
import { aiDiagnosisKey, queryKeys, useAttemptAiDiagnosis } from '@/lib/queries';
import type { AttemptAiDiagnosis } from '@/lib/types';

/** Trường văn bản hiện dần khi model stream JSON của `diagnose_rl` */
export const DIAGNOSIS_PREVIEW_FIELDS = ['top_error_type', 'evidence', 'why', 'steps', 'encouragement'] as const;

const parseDiagnosis = (d: unknown): AttemptAiDiagnosis | null => {
  const r = attemptAiDiagnosisSchema.safeParse(d);
  return r.success ? r.data : null;
};

export interface AiDiagnosisController {
  /** Kết quả đã lưu (GET) hoặc vừa sinh (POST) */
  data: AttemptAiDiagnosis | null;
  stream: AiStreamState<AttemptAiDiagnosis>;
  /** Đang đọc GET lần đầu */
  loading: boolean;
  loadError: unknown;
  generate: () => void;
}

/**
 * Chẩn đoán AI (`diagnose_rl`, v1.1 – S5): GET /attempts/{id}/diagnosis đọc kết quả đã lưu (404 → chưa có);
 * POST → SSE start → delta* → result → done (gọi lại khi đã có → start{cached:true} → result, không trừ credit).
 * Kết quả ghi vào query GET để tải lại / quay lại màn vẫn hiện.
 */
export function useAiDiagnosis(attemptId: string): AiDiagnosisController {
  const qc = useQueryClient();
  const saved = useAttemptAiDiagnosis(attemptId);
  const [stream, dispatch] = React.useReducer(aiStreamReducer<AttemptAiDiagnosis>, null, () => initialAiStream<AttemptAiDiagnosis>());
  const abortRef = React.useRef<AbortController | null>(null);

  const generate = React.useCallback(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    dispatch({ type: 'request' });
    const onAction = (a: AiStreamAction<AttemptAiDiagnosis>) => {
      dispatch(a);
      if (a.type === 'result' || a.type === 'loaded') qc.setQueryData(aiDiagnosisKey(attemptId), a.data);
    };
    void (async () => {
      try {
        const res = await postJsonOrStream(`/attempts/${attemptId}/diagnosis`, {}, ac.signal);
        await consumeAiResponse(res, parseDiagnosis, onAction, ac.signal);
        // Trừ credit (Pro) → số credit trên màn hình
        if (!ac.signal.aborted) void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
      } catch (err) {
        const e = toAiStreamError(err);
        if (!e || ac.signal.aborted) return;
        dispatch({ type: 'error', error: e });
        if (e.status === 429 || e.status === 503) notifyApiError(aiErrorToApiError(e));
      }
    })();
  }, [attemptId, qc]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const data = stream.status === 'done' && stream.data ? stream.data : (saved.data ?? null);
  return { data, stream, loading: saved.isPending, loadError: saved.isError ? saved.error : null, generate };
}
