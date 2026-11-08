'use client';

import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { ErrorLogEntry, ErrorLogPage, ErrorPatch } from '@allingo/schemas/api/learning-s10';
import { createErrorDrill, getErrors, patchError, type ErrorDrillBody } from '@/lib/s10-api';
import { handleExamLockedError } from '@/lib/exam-lock';
import type { Attempt } from '@/lib/types';
import { PROGRAM } from '@/features/plan/queries';
import { applyEntryPatch, errorFiltersToQuery, type ErrorFilters } from './filters';

/** Khoá dưới ['me', 'errors', …] – nộp bài (`invalidateQueries(['me'])`) làm mới sổ lỗi; sửa lỗi làm mới thống kê + lộ trình */
export const errorKeys = {
  all: ['me', 'errors'] as const,
  list: (program: string, f: ErrorFilters) => ['me', 'errors', program, f] as const,
};

export function useErrorLog(f: ErrorFilters, program = PROGRAM) {
  return useInfiniteQuery<ErrorLogPage, Error, InfiniteData<ErrorLogPage>, ReturnType<typeof errorKeys.list>, string | null>({
    queryKey: errorKeys.list(program, f),
    queryFn: async ({ pageParam }) => {
      try {
        return await getErrors({ ...errorFiltersToQuery(f, program), cursor: pageParam });
      } catch (e) {
        // 403 exam_mode_locked → banner "Tiếp tục bài thi" (lib/exam-lock)
        handleExamLockedError(e);
        throw e;
      }
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function usePatchError(f: ErrorFilters, program = PROGRAM) {
  const qc = useQueryClient();
  return useMutation<ErrorLogEntry, Error, { id: string; patch: ErrorPatch }, { prev: InfiniteData<ErrorLogPage> | undefined }>({
    mutationFn: ({ id, patch }) => patchError(id, patch),
    onMutate: async ({ id, patch }) => {
      const key = errorKeys.list(program, f);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InfiniteData<ErrorLogPage>>(key);
      if (prev) qc.setQueryData<InfiniteData<ErrorLogPage>>(key, { ...prev, pages: prev.pages.map((p) => ({ ...p, data: applyEntryPatch(p.data, id, patch, f.status) })) });
      return { prev };
    },
    onSuccess: (entry) => {
      // Ghép bản server (srs_card_id mới, kind hiệu lực…) vào mục còn trong danh sách
      const key = errorKeys.list(program, f);
      const cur = qc.getQueryData<InfiniteData<ErrorLogPage>>(key);
      if (cur) qc.setQueryData<InfiniteData<ErrorLogPage>>(key, { ...cur, pages: cur.pages.map((p) => ({ ...p, data: p.data.map((e) => (e.id === entry.id ? { ...e, ...entry, question: entry.question ?? e.question } : e)) })) });
    },
    onError: (e, _v, ctx) => {
      handleExamLockedError(e);
      if (ctx?.prev) qc.setQueryData(errorKeys.list(program, f), ctx.prev);
    },
    onSettled: (_d, _e, { patch }) => {
      // Tổng/biểu đồ phân bố tính lại ở server; thẻ SRS mới → ôn tập; đã hiểu → task review_errors có thể tự xong
      if (patch.resolved !== undefined || patch.reason_override !== undefined) void qc.invalidateQueries({ queryKey: errorKeys.all, refetchType: 'inactive' });
      void qc.invalidateQueries({ queryKey: ['me', 'stats', program] });
      if (patch.create_card) void qc.invalidateQueries({ queryKey: ['me', 'srs'] });
      if (patch.resolved) void qc.invalidateQueries({ queryKey: ['me', 'plan', program] });
    },
  });
}

export function useErrorDrill() {
  return useMutation<Attempt, Error, ErrorDrillBody>({
    mutationFn: (body) => createErrorDrill(body),
    onError: (e) => void handleExamLockedError(e),
  });
}
