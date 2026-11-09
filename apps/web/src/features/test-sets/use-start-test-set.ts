'use client';

import * as React from 'react';
import { unwrap } from '@allingo/api-client';
import { getApi } from '@/lib/api';
import { useCreateAttempt } from '@/lib/queries';
import { useRouter } from '@/i18n/navigation';
import type { AttemptMode, TestSet, TestSetSummary } from '@/lib/types';
import { useProgram } from '@/features/program/program-context';

export interface StartTarget {
  summary: TestSetSummary;
}

/**
 * Luồng mở đề: bấm thẻ → GET /test-sets/{id}; có in_progress_attempt_id → tiếp tục;
 * không → mở hộp thoại chọn Thi/Luyện → POST /attempts (Idempotency-Key) → /attempts/[id].
 */
export function useStartTestSet() {
  // C1: lượt làm thuộc chương trình của khu học hiện hành
  const program = useProgram();
  const router = useRouter();
  const create = useCreateAttempt();
  const [target, setTarget] = React.useState<StartTarget | null>(null);
  const [checking, setChecking] = React.useState<string | null>(null);
  const [checkError, setCheckError] = React.useState<unknown>(null);

  const open = React.useCallback(
    async (summary: TestSetSummary) => {
      if (summary.locked) return;
      setChecking(summary.id);
      setCheckError(null);
      try {
        const detail = unwrap(await getApi().GET('/test-sets/{testSetId}', { params: { path: { testSetId: summary.id } } })) as unknown as TestSet;
        if (detail.in_progress_attempt_id) {
          router.push(`/attempts/${detail.in_progress_attempt_id}`);
          return;
        }
        setTarget({ summary });
      } catch (err) {
        setCheckError(err);
      } finally {
        setChecking(null);
      }
    },
    [router],
  );

  const start = React.useCallback(
    (mode: AttemptMode) => {
      if (!target) return;
      create.mutate(
        { program, mode, test_set_id: target.summary.id },
        {
          onSuccess: (attempt) => {
            setTarget(null);
            router.push(`/attempts/${attempt.id}`);
          },
        },
      );
    },
    [create, program, router, target],
  );

  return { target, setTarget, open, start, checking, checkError, create };
}
