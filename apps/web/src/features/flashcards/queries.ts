'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { SrsDueList, VocabEnrollResult, VocabList } from '@allingo/schemas';
import { enrollVocabList, getSrsDue, getVocabLists } from '@/lib/s10-api';
import { PROGRAM } from '@/features/plan/queries';

/**
 * Hook TanStack cho từ vựng/ôn thẻ (S10). Khoá dưới ['me', …] để `invalidateQueries(['me'])` có sẵn (đăng nhập, nộp bài…) cũng
 * làm mới. Sau ôn/đăng ký bộ: làm mới bộ từ, thẻ đến hạn, thống kê (vocab), lộ trình (task vocab_review tự xong ở server).
 */
export const vocabKeys = {
  lists: (program: string) => ['me', 'vocab', program, 'lists'] as const,
  items: (listId: string) => ['me', 'vocab', 'items', listId] as const,
  due: (program: string, listId?: string | null) => ['me', 'srs', program, 'due', listId ?? 'all'] as const,
  dueAll: ['me', 'srs'] as const,
};

type Opts<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>;

export function useVocabLists(program = PROGRAM, opts?: Opts<VocabList[]>) {
  return useQuery<VocabList[], Error>({ queryKey: vocabKeys.lists(program), queryFn: () => getVocabLists(program), ...opts });
}

/** Số thẻ đến hạn / thẻ mới còn hôm nay (limit 1 – chỉ cần `counts`) */
export function useSrsCounts(program = PROGRAM, listId?: string | null, opts?: Opts<SrsDueList>) {
  return useQuery<SrsDueList, Error>({ queryKey: [...vocabKeys.due(program, listId), 'counts'], queryFn: () => getSrsDue({ program, list_id: listId, limit: 1 }), ...opts });
}

export function useInvalidateVocab() {
  const qc = useQueryClient();
  return (program = PROGRAM) => {
    void qc.invalidateQueries({ queryKey: ['me', 'vocab'] });
    void qc.invalidateQueries({ queryKey: vocabKeys.dueAll });
    void qc.invalidateQueries({ queryKey: ['me', 'stats', program] });
    void qc.invalidateQueries({ queryKey: ['me', 'plan', program] });
  };
}

export function useEnrollList(program = PROGRAM) {
  const invalidate = useInvalidateVocab();
  return useMutation<VocabEnrollResult, Error, string>({
    mutationFn: (listId) => enrollVocabList(listId),
    onSuccess: () => invalidate(program),
  });
}
