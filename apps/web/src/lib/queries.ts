'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { unwrap } from '@allingo/api-client';
import { attemptAiDiagnosisSchema } from '@allingo/schemas/api/core';
import { queryKeys } from '@allingo/api-client/react';
import { getApi } from './api';
import { login, logout, register } from './auth';
import type {
  Attempt,
  AttemptAiDiagnosis,
  AttemptAnswersPut,
  AttemptCreate,
  AttemptEvent,
  AttemptMediaList,
  AttemptResult,
  AttemptReview,
  AttemptSummary,
  Enrollment,
  EnrollmentInput,
  Entitlements,
  Page,
  Program,
  Stats,
  TestSet,
  TestSetSummary,
  User,
  UserUpdate,
} from './types';

/**
 * Hook TanStack Query typed theo Zod của packages/schemas. Dùng lại queryKeys của @allingo/api-client/react
 * để invalidate nhất quán; các hook trong gói đó trả kiểu OpenAPI (thiếu trường) nên bọc lại ở đây.
 */

type Opts<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>;

export { queryKeys };

export function useMe(opts?: Opts<User>): UseQueryResult<User, Error> {
  return useQuery<User, Error>({
    queryKey: queryKeys.me,
    queryFn: async () => unwrap(await getApi().GET('/me')) as unknown as User,
    retry: false,
    staleTime: 60_000,
    ...opts,
  });
}

export function usePrograms(opts?: Opts<Program[]>) {
  return useQuery<Program[], Error>({
    queryKey: queryKeys.programs,
    queryFn: async () => unwrap(await getApi().GET('/programs')) as unknown as Program[],
    staleTime: 5 * 60_000,
    ...opts,
  });
}

export function useStats(program: string, opts?: Opts<Stats>) {
  return useQuery<Stats, Error>({
    queryKey: queryKeys.stats(program),
    queryFn: async () => unwrap(await getApi().GET('/me/stats', { params: { query: { program } } as never })) as unknown as Stats,
    ...opts,
  });
}

export function useEntitlements(program: string, opts?: Opts<Entitlements>) {
  return useQuery<Entitlements, Error>({
    queryKey: [...queryKeys.entitlements, program],
    queryFn: async () => unwrap(await getApi().GET('/me/entitlements', { params: { query: { program } } as never })) as unknown as Entitlements,
    ...opts,
  });
}

export function useEnrollments(opts?: Opts<Enrollment[]>) {
  return useQuery<Enrollment[], Error>({
    queryKey: queryKeys.enrollments,
    queryFn: async () => unwrap(await getApi().GET('/me/enrollments')) as unknown as Enrollment[],
    ...opts,
  });
}

export function useTestSets(program: string, kind?: string, opts?: Opts<Page<TestSetSummary>>) {
  return useQuery<Page<TestSetSummary>, Error>({
    queryKey: queryKeys.testSets(program, kind),
    queryFn: async () =>
      unwrap(
        await getApi().GET('/programs/{program}/test-sets', {
          params: { path: { program: program as never }, query: (kind ? { kind } : {}) as never },
        }),
      ) as unknown as Page<TestSetSummary>,
    ...opts,
  });
}

export function useTestSet(testSetId: string, opts?: Opts<TestSet>) {
  return useQuery<TestSet, Error>({
    queryKey: queryKeys.testSet(testSetId),
    queryFn: async () => unwrap(await getApi().GET('/test-sets/{testSetId}', { params: { path: { testSetId } } })) as unknown as TestSet,
    ...opts,
  });
}

export function useAttempt(attemptId: string, opts?: Opts<Attempt>) {
  return useQuery<Attempt, Error>({
    queryKey: queryKeys.attempt(attemptId),
    queryFn: async () => unwrap(await getApi().GET('/attempts/{attemptId}', { params: { path: { attemptId } } })) as unknown as Attempt,
    ...opts,
  });
}

/** Tham số lọc của GET /attempts/{id}/review (kết hợp được: sai + Part, đánh dấu + Part) */
export interface AttemptReviewFilter {
  only_wrong?: boolean;
  flagged?: boolean;
  section?: string;
}

export function useAttemptReview(attemptId: string, filter: AttemptReviewFilter = {}, opts?: Opts<AttemptReview>) {
  const query = { ...(filter.only_wrong ? { only_wrong: true } : {}), ...(filter.flagged ? { flagged: true } : {}), ...(filter.section ? { section: filter.section } : {}) };
  return useQuery<AttemptReview, Error>({
    queryKey: ['attempts', attemptId, 'review', query] as const,
    queryFn: async () => unwrap(await getApi().GET('/attempts/{attemptId}/review', { params: { path: { attemptId }, query } })) as unknown as AttemptReview,
    ...opts,
  });
}

/** Lọc lịch sử bài làm (GET /me/attempts v1.1): trạng thái, chế độ, khoảng ngày YYYY-MM-DD theo UTC */
export interface MyAttemptsFilter {
  program?: string;
  status?: string;
  mode?: string;
  from?: string;
  to?: string;
}

export function useMyAttempts(filter?: string | MyAttemptsFilter, opts?: Opts<Page<AttemptSummary>>) {
  const f: MyAttemptsFilter = typeof filter === 'string' ? { program: filter } : (filter ?? {});
  const query = Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === 'string' && v.length > 0));
  const onlyProgram = Object.keys(query).every((k) => k === 'program');
  return useQuery<Page<AttemptSummary>, Error>({
    queryKey: onlyProgram ? queryKeys.myAttempts(f.program) : [...queryKeys.myAttempts(f.program), query],
    queryFn: async () => unwrap(await getApi().GET('/me/attempts', { params: { query: query as never } })) as unknown as Page<AttemptSummary>,
    ...opts,
  });
}

// ----------------------------------------------------------------------------- Mutations

export function useCreateAttempt() {
  const qc = useQueryClient();
  return useMutation<Attempt, Error, AttemptCreate>({
    mutationFn: async (body) =>
      unwrap(await getApi().POST('/attempts', { params: { header: { 'Idempotency-Key': crypto.randomUUID() } }, body: body as never })) as unknown as Attempt,
    onSuccess: (attempt) => {
      qc.setQueryData(queryKeys.attempt(attempt.id), attempt);
      void qc.invalidateQueries({ queryKey: ['me', 'attempts'] });
      void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
      void qc.invalidateQueries({ queryKey: ['test-sets'] });
    },
  });
}

/** Lưu nháp (PUT) – hàm thuần để hàng đợi lưu nháp gọi ngoài React */
export async function saveAnswers(attemptId: string, body: AttemptAnswersPut): Promise<void> {
  unwrap(await getApi().PUT('/attempts/{attemptId}/answers', { params: { path: { attemptId } }, body: body as never }));
}

/**
 * URL ký mới cho mọi media của attempt (GET /attempts/{id}/media – v1.1, Sprint 4): gia hạn trước khi hết hạn (TTL 10′)
 * hoặc khi audio lỗi 403. Hàm thuần (không cache TanStack – mỗi lần gọi là URL mới, `Cache-Control: no-store`).
 */
export async function fetchAttemptMedia(attemptId: string): Promise<AttemptMediaList> {
  // Kiểu OpenAPI sinh ra trùng dạng Zod (AttemptMediaList) – không cần ép kiểu
  const data: AttemptMediaList = unwrap(await getApi().GET('/attempts/{attemptId}/media', { params: { path: { attemptId } } }));
  return data;
}

/** Sự kiện phiên (tab_leave, resume, audio_played...) – fire-and-forget, lỗi bỏ qua */
export function sendAttemptEvent(attemptId: string, event: AttemptEvent): void {
  void getApi()
    .POST('/attempts/{attemptId}/events', { params: { path: { attemptId } }, body: { ...event, at: event.at ?? new Date().toISOString() } as never })
    .catch(() => undefined);
}

export function useSubmitAttempt(attemptId: string) {
  const qc = useQueryClient();
  return useMutation<AttemptResult, Error, void>({
    mutationFn: async () => unwrap(await getApi().POST('/attempts/{attemptId}/submit', { params: { path: { attemptId } } })) as unknown as AttemptResult,
    onSuccess: (result) => {
      qc.setQueryData(resultKey(attemptId), result);
      // exact: không làm hỏng kết quả vừa nhận (resultKey có cùng tiền tố ['attempts', id]; GET /result trả xp_earned = 0)
      void qc.invalidateQueries({ queryKey: queryKeys.attempt(attemptId), exact: true });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export const resultKey = (attemptId: string) => ['attempts', attemptId, 'result'] as const;

/** Kết quả đã chấm: GET /attempts/{id}/result (SPEC-ISSUES S8). 409 khi chưa nộp. */
export function useAttemptResult(attemptId: string, opts?: Opts<AttemptResult>) {
  return useQuery<AttemptResult, Error>({
    queryKey: resultKey(attemptId),
    queryFn: async () =>
      unwrap(await getApi().GET('/attempts/{attemptId}/result', { params: { path: { attemptId } } })) as unknown as AttemptResult,
    staleTime: Infinity,
    ...opts,
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation<User, Error, UserUpdate>({
    mutationFn: async (body) => unwrap(await getApi().PATCH('/me', { body: body as never })) as unknown as User,
    onSuccess: (user) => qc.setQueryData(queryKeys.me, user),
  });
}

export function useUpsertEnrollment() {
  const qc = useQueryClient();
  return useMutation<Enrollment, Error, { input: EnrollmentInput; exists: boolean }>({
    mutationFn: async ({ input, exists }) => {
      const api = getApi();
      if (exists) {
        const { program, ...rest } = input;
        return unwrap(await api.PATCH('/me/enrollments/{program}', { params: { path: { program: program as never } }, body: rest as never })) as unknown as Enrollment;
      }
      return unwrap(await api.POST('/me/enrollments', { body: input as never })) as unknown as Enrollment;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.enrollments });
      void qc.invalidateQueries({ queryKey: ['me', 'stats'] });
    },
  });
}

export type AiFeedbackRating = 'helpful' | 'not_helpful' | 'wrong';
export interface AiFeedbackInput {
  ai_task_id: string;
  rating: AiFeedbackRating;
  comment?: string;
}
export interface AiFeedbackResult {
  ok?: boolean;
  id?: string;
  ai_task_id?: string;
  rating?: string;
  /** true khi gửi lại cho cùng tác vụ (cập nhật phản hồi cũ) */
  updated?: boolean;
}

/** POST /ai/feedback (v1.1 – S5): 👍/👎/Sai + ghi chú; gửi lại cho cùng ai_task_id = cập nhật */
export function useAiFeedback() {
  return useMutation<AiFeedbackResult, Error, AiFeedbackInput>({
    mutationFn: async (body): Promise<AiFeedbackResult> => unwrap(await getApi().POST('/ai/feedback', { body })) ?? {},
  });
}

export const aiDiagnosisKey = (attemptId: string) => ['attempts', attemptId, 'ai-diagnosis'] as const;

/**
 * Chẩn đoán AI đã lưu (GET /attempts/{id}/diagnosis – v1.1 S5): 404 = chưa tạo → null (không phải lỗi).
 * Tạo mới bằng POST (SSE) trong `features/result/use-ai-diagnosis.ts`, kết quả ghi vào cùng khoá query.
 */
export function useAttemptAiDiagnosis(attemptId: string, opts?: Opts<AttemptAiDiagnosis | null>) {
  return useQuery<AttemptAiDiagnosis | null, Error>({
    queryKey: aiDiagnosisKey(attemptId),
    queryFn: async () => {
      const res = await getApi().GET('/attempts/{attemptId}/diagnosis', { params: { path: { attemptId } } });
      if (res.response.status === 404) return null;
      const parsed = attemptAiDiagnosisSchema.safeParse(unwrap(res));
      return parsed.success ? parsed.data : null;
    },
    staleTime: Infinity,
    retry: false,
    ...opts,
  });
}

// ----------------------------------------------------------------------------- Auth

/** Tách sang lib/guest.ts (landing không tải Zod/@allingo/schemas) – giữ tên xuất cũ */
export { useStartGuest } from './guest';

export function useRegister() {
  const qc = useQueryClient();
  return useMutation<User, Error, Parameters<typeof register>[0]>({
    mutationFn: register,
    // Form tự hiện lỗi (429 khoá đăng nhập/giới hạn tốc độ) tại chỗ – không phát toast chung
    meta: { inlineErrors: true },
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(queryKeys.me, user);
    },
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<User, Error, Parameters<typeof login>[0]>({
    mutationFn: login,
    // Form tự hiện lỗi (429 khoá đăng nhập/giới hạn tốc độ) tại chỗ – không phát toast chung
    meta: { inlineErrors: true },
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(queryKeys.me, user);
    },
  });
}

/** Đăng nhập bằng OTP email hoặc Google: cùng hậu xử lý như login */
export function useSignInWith<TInput>(fn: (input: TInput) => Promise<User>) {
  const qc = useQueryClient();
  return useMutation<User, Error, TInput>({
    mutationFn: fn,
    // Form tự hiện lỗi (429 khoá đăng nhập/giới hạn tốc độ) tại chỗ – không phát toast chung
    meta: { inlineErrors: true },
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(queryKeys.me, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: logout,
    onSettled: () => qc.clear(),
  });
}
