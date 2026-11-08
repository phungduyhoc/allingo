'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@allingo/api-client';
import type { PlanTask } from '@allingo/schemas/api/learning-plan';
import { useRouter } from '@/i18n/navigation';
import { queryKeys } from '@/lib/queries';
import { createErrorsDrill, createPlanAttempt } from '@/lib/plan-api';
import type { Attempt } from '@/lib/types';
import { launchAction, launchIdempotencyKey } from './launch';
import { rememberPlanLaunch, type PlanLaunchRecord } from './launch-memory';
import { PROGRAM, usePatchTask } from './queries';

/**
 * Bấm task → mở đúng màn (S9): bài làm (POST /attempts kèm `plan_task_id`, Idempotency-Key theo task) / drill từ sổ lỗi (S10;
 * 404 không còn lỗi → trang Sổ lỗi) / bài học / phiên ôn bộ từ (S10) / hộp thoại check-in / tự đánh dấu xong. Lỗi tạo lượt (429 hạn mức, 403 cần Pro…) đi qua MutationCache → toast hạn mức chung,
 * và trả về `error` để hiển thị tại chỗ.
 */
export function useLaunchTask(opts: { returnTo: PlanLaunchRecord['return_to']; onCheckin: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const patch = usePatchTask(PROGRAM);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const create = useMutation<Attempt, Error, { task: PlanTask }>({
    mutationFn: async ({ task }) => {
      const action = launchAction(task, PROGRAM);
      if (action.kind === 'errors_drill') return createErrorsDrill(action.program, action.plan_task_id);
      if (action.kind !== 'attempt') throw new Error('not an attempt task');
      return createPlanAttempt(action.body, launchIdempotencyKey(task));
    },
    onSuccess: (attempt, { task }) => {
      qc.setQueryData(queryKeys.attempt(attempt.id), attempt);
      void qc.invalidateQueries({ queryKey: ['me', 'attempts'] });
      void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
      if (task.status === 'pending') rememberPlanLaunch(attempt.id, { task_id: task.id, return_to: opts.returnTo });
      router.push(`/attempts/${attempt.id}`);
    },
    onError: (err, { task }) => {
      // S10: review_errors khi không còn lỗi chưa hiểu (404) → mở Sổ lỗi (đánh dấu xong ở đó / chọn lỗi khác)
      if (err instanceof ApiError && err.status === 404 && launchAction(task, PROGRAM).kind === 'errors_drill') router.push(`/toeic/errors?task=${encodeURIComponent(task.id)}`);
    },
  });

  const launch = React.useCallback(
    (task: PlanTask) => {
      const action = launchAction(task, PROGRAM);
      switch (action.kind) {
        case 'attempt':
        case 'errors_drill':
          setBusyId(task.id);
          create.mutate({ task }, { onSettled: () => setBusyId(null) });
          return;
        case 'route':
          router.push(action.href);
          return;
        case 'checkin':
          opts.onCheckin();
          return;
        case 'self':
          if (task.status === 'pending') patch.mutate({ taskId: task.id, patch: { status: 'done' } });
          return;
      }
    },
    [create, opts, patch, router],
  );

  return { launch, busyId, error: create.error, errorTaskId: create.variables?.task.id ?? null, reset: create.reset };
}
