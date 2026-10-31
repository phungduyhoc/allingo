import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { unwrap, type ApiClient, type components } from './index.js';

type S = components['schemas'];

/** Khoá query chuẩn để invalidate nhất quán giữa các màn hình */
export const queryKeys = {
  me: ['me'] as const,
  enrollments: ['me', 'enrollments'] as const,
  entitlements: ['me', 'entitlements'] as const,
  credits: ['me', 'credits'] as const,
  stats: (program: string) => ['me', 'stats', program] as const,
  programs: ['programs'] as const,
  testSets: (program: string, kind?: string) => ['programs', program, 'test-sets', kind ?? 'all'] as const,
  testSet: (id: string) => ['test-sets', id] as const,
  attempt: (id: string) => ['attempts', id] as const,
  attemptReview: (id: string, onlyWrong?: boolean) => ['attempts', id, 'review', onlyWrong ? 'wrong' : 'all'] as const,
  myAttempts: (program?: string) => ['me', 'attempts', program ?? 'all'] as const,
};

type QueryOpts<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>;

export function useMe(api: ApiClient, opts?: QueryOpts<S['User']>) {
  return useQuery<S['User'], Error>({ queryKey: queryKeys.me, queryFn: async () => unwrap(await api.GET('/me')), retry: false, ...opts });
}

export function useEnrollments(api: ApiClient, opts?: QueryOpts<S['Enrollment'][]>) {
  return useQuery<S['Enrollment'][], Error>({ queryKey: queryKeys.enrollments, queryFn: async () => unwrap(await api.GET('/me/enrollments')), ...opts });
}

export function useEntitlements(api: ApiClient, program: string, opts?: QueryOpts<S['Entitlements']>) {
  return useQuery<S['Entitlements'], Error>({
    queryKey: [...queryKeys.entitlements, program],
    queryFn: async () => unwrap(await api.GET('/me/entitlements', { params: { query: { program } } as never })),
    ...opts,
  });
}

export function useStats(api: ApiClient, program: string, opts?: QueryOpts<S['Stats']>) {
  return useQuery<S['Stats'], Error>({ queryKey: queryKeys.stats(program), queryFn: async () => unwrap(await api.GET('/me/stats', { params: { query: { program } } as never })), ...opts });
}

export function usePrograms(api: ApiClient, opts?: QueryOpts<S['Program'][]>) {
  return useQuery<S['Program'][], Error>({ queryKey: queryKeys.programs, queryFn: async () => unwrap(await api.GET('/programs')), staleTime: 5 * 60_000, ...opts });
}

export function useTestSets(api: ApiClient, program: string, kind?: string, opts?: QueryOpts<S['TestSetPage']>) {
  return useQuery<S['TestSetPage'], Error>({
    queryKey: queryKeys.testSets(program, kind),
    queryFn: async () => unwrap(await api.GET('/programs/{program}/test-sets', { params: { path: { program: program as never }, query: kind ? ({ kind } as never) : undefined } })),
    ...opts,
  });
}

export function useTestSet(api: ApiClient, testSetId: string, opts?: QueryOpts<S['TestSet']>) {
  return useQuery<S['TestSet'], Error>({ queryKey: queryKeys.testSet(testSetId), queryFn: async () => unwrap(await api.GET('/test-sets/{testSetId}', { params: { path: { testSetId } } })), ...opts });
}

export function useAttempt(api: ApiClient, attemptId: string, opts?: QueryOpts<S['Attempt']>) {
  return useQuery<S['Attempt'], Error>({ queryKey: queryKeys.attempt(attemptId), queryFn: async () => unwrap(await api.GET('/attempts/{attemptId}', { params: { path: { attemptId } } })), ...opts });
}

export function useAttemptReview(api: ApiClient, attemptId: string, onlyWrong = false, opts?: QueryOpts<S['AttemptReview']>) {
  return useQuery<S['AttemptReview'], Error>({
    queryKey: queryKeys.attemptReview(attemptId, onlyWrong),
    queryFn: async () => unwrap(await api.GET('/attempts/{attemptId}/review', { params: { path: { attemptId }, query: { only_wrong: onlyWrong } } })),
    ...opts,
  });
}

export function useMyAttempts(api: ApiClient, program?: string, opts?: QueryOpts<{ data: S['AttemptSummary'][]; next_cursor: string | null }>) {
  return useQuery<{ data: S['AttemptSummary'][]; next_cursor: string | null }, Error>({
    queryKey: queryKeys.myAttempts(program),
    queryFn: async () => unwrap(await api.GET('/me/attempts', { params: { query: (program ? { program } : {}) as never } })) as { data: S['AttemptSummary'][]; next_cursor: string | null },
    ...opts,
  });
}

export function useCreateAttempt(api: ApiClient) {
  const qc = useQueryClient();
  return useMutation<S['Attempt'], Error, S['AttemptCreate']>({
    mutationFn: async (body) => unwrap(await api.POST('/attempts', { params: { header: { 'Idempotency-Key': crypto.randomUUID() } }, body: body as never })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'attempts'] });
      void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
    },
  });
}

export function useSaveAnswers(api: ApiClient, attemptId: string) {
  return useMutation<void, Error, { answers: S['AttemptAnswerInput'][]; section_elapsed_sec?: Record<string, number>; ui_state?: Record<string, unknown> }>({
    mutationFn: async (body) => {
      unwrap(await api.PUT('/attempts/{attemptId}/answers', { params: { path: { attemptId } }, body: body as never }));
    },
  });
}

export function useSubmitAttempt(api: ApiClient, attemptId: string) {
  const qc = useQueryClient();
  return useMutation<S['AttemptResult'], Error, void>({
    mutationFn: async () => unwrap(await api.POST('/attempts/{attemptId}/submit', { params: { path: { attemptId } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.attempt(attemptId) });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useLogout(api: ApiClient) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await api.POST('/auth/logout');
    },
    onSuccess: () => qc.clear(),
  });
}
