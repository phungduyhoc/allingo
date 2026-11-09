'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { PlanAdjustProposal, PlanCheckinInput, PlanCreateInput, PlanTask, PlanTaskPatch, PlanToday, StudyPlan } from '@allingo/schemas/api/learning-plan';
import type { ProgramCode } from '@allingo/schemas/common';
import { queryKeys } from '@/lib/queries';
import {
  applyProposal,
  createPlan,
  getBadges,
  getPlan,
  getToday,
  instructAdjust,
  listProposals,
  patchPlanTask,
  regeneratePlan,
  submitCheckin,
  type BadgeList,
} from '@/lib/plan-api';
import { ApiError } from '@allingo/api-client';
import { applyMove, dayStatus, sortDayTasks } from './reschedule';
import { DEFAULT_PROGRAM } from '@allingo/schemas/program/registry';

/**
 * Hook TanStack Query cho lộ trình (S9). Khoá nằm dưới ['me', …] để mọi `invalidateQueries(['me'])` sẵn có (nộp bài, đăng nhập…)
 * cũng làm mới lộ trình/hôm nay/huy hiệu. Realtime `plan.updated` → `invalidatePlan` (features/realtime/realtime-provider.tsx).
 */

/** Chương trình mặc định của hook khi caller không truyền (C1: component truyền `useProgram()`) */
export const PROGRAM: ProgramCode = DEFAULT_PROGRAM;

export const planKeys = {
  all: ['me', 'plan'] as const,
  scope: (program: string) => ['me', 'plan', program] as const,
  plan: (program: string) => ['me', 'plan', program, 'detail'] as const,
  today: (program: string) => ['me', 'plan', program, 'today'] as const,
  proposals: (program: string) => ['me', 'plan', program, 'proposals'] as const,
  badges: (program: string) => ['me', 'badges', program] as const,
};

type Opts<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>;

export function usePlan(program = PROGRAM, opts?: Opts<StudyPlan | null>) {
  return useQuery<StudyPlan | null, Error>({ queryKey: planKeys.plan(program), queryFn: () => getPlan(program), ...opts });
}

export function useToday(program = PROGRAM, opts?: Opts<PlanToday>) {
  return useQuery<PlanToday, Error>({ queryKey: planKeys.today(program), queryFn: () => getToday(program), ...opts });
}

export function useProposals(program = PROGRAM, opts?: Opts<PlanAdjustProposal[]>) {
  return useQuery<PlanAdjustProposal[], Error>({ queryKey: planKeys.proposals(program), queryFn: () => listProposals(program, 10), ...opts });
}

export function useBadges(program = PROGRAM, opts?: Opts<BadgeList>) {
  return useQuery<BadgeList, Error>({ queryKey: planKeys.badges(program), queryFn: () => getBadges(program), ...opts });
}

/** Làm mới mọi dữ liệu lộ trình + thống kê (streak/XP/huy hiệu) */
export function useInvalidatePlan() {
  const qc = useQueryClient();
  return (program = PROGRAM) => {
    void qc.invalidateQueries({ queryKey: planKeys.scope(program) });
    void qc.invalidateQueries({ queryKey: queryKeys.stats(program) });
    void qc.invalidateQueries({ queryKey: planKeys.badges(program) });
  };
}

// ----------------------------------------------------------------------------- task

/** Áp patch lên task trong cây StudyPlan (lạc quan) */
function patchPlanCache(plan: StudyPlan, taskId: string, patch: PlanTaskPatch): StudyPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((w) => {
      if (!w.days.some((d) => d.tasks.some((t) => t.id === taskId))) return w;
      let next = patch.due_date ? applyMove(w, taskId, patch.due_date) : w;
      if (patch.status) {
        next = {
          ...next,
          days: next.days.map((d) => {
            if (!d.tasks.some((t) => t.id === taskId)) return d;
            const tasks = d.tasks.map((t) => (t.id === taskId ? { ...t, status: patch.status!, overdue: patch.status === 'pending' ? t.overdue : false } : t));
            return { ...d, tasks: sortDayTasks(tasks), status: dayStatus(tasks) };
          }),
        };
      }
      return next;
    }),
  };
}

function patchTodayCache(today: PlanToday, taskId: string, patch: PlanTaskPatch): PlanToday {
  const upd = (t: PlanTask): PlanTask => (t.id === taskId ? { ...t, ...(patch.status ? { status: patch.status } : {}), ...(patch.due_date ? { due_date: patch.due_date } : {}) } : t);
  const moved = patch.due_date && patch.due_date !== today.date;
  return {
    ...today,
    tasks: today.tasks.map(upd).filter((t) => !(moved && t.id === taskId)),
    overdue: today.overdue.map(upd).filter((t) => t.status === 'pending'),
  };
}

export function usePatchTask(program = PROGRAM) {
  const qc = useQueryClient();
  const invalidate = useInvalidatePlan();
  return useMutation<PlanTask, Error, { taskId: string; patch: PlanTaskPatch }, { plan?: StudyPlan | null; today?: PlanToday }>({
    mutationFn: ({ taskId, patch }) => patchPlanTask(taskId, patch),
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: planKeys.scope(program) });
      const plan = qc.getQueryData<StudyPlan | null>(planKeys.plan(program));
      const today = qc.getQueryData<PlanToday>(planKeys.today(program));
      if (plan) qc.setQueryData(planKeys.plan(program), patchPlanCache(plan, taskId, patch));
      if (today) qc.setQueryData(planKeys.today(program), patchTodayCache(today, taskId, patch));
      return { plan, today };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.plan !== undefined) qc.setQueryData(planKeys.plan(program), ctx.plan);
      if (ctx?.today !== undefined) qc.setQueryData(planKeys.today(program), ctx.today);
    },
    onSettled: () => invalidate(program),
  });
}

/** Mã lỗi đổi ngày (PATCH 400 `details.issues[0].message` của API) → khoá i18n `plan.moveError.*` */
export function moveErrorKey(err: unknown): 'sameWeek' | 'past' | 'exam' | 'notPending' | 'forbidden' | 'generic' {
  if (!(err instanceof ApiError)) return 'generic';
  if (err.status === 403) return 'forbidden';
  const issues = (err.details?.issues as Array<{ message?: string }> | undefined) ?? [];
  const msg = issues.map((i) => i.message ?? '').join(' ');
  if (/same plan week/.test(msg)) return 'sameWeek';
  if (/past/.test(msg)) return 'past';
  if (/exam_date/.test(msg)) return 'exam';
  if (/only pending/.test(msg)) return 'notPending';
  return 'generic';
}

// ----------------------------------------------------------------------------- lộ trình

export function useCreatePlan() {
  const qc = useQueryClient();
  const invalidate = useInvalidatePlan();
  return useMutation<StudyPlan, Error, PlanCreateInput>({
    mutationFn: createPlan,
    onSuccess: (plan) => {
      qc.setQueryData(planKeys.plan(plan.program), plan);
      invalidate(plan.program);
      void qc.invalidateQueries({ queryKey: queryKeys.enrollments });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useRegeneratePlan(program = PROGRAM) {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: () => regeneratePlan(program),
    onSuccess: (r) => {
      // inline (dev) → đã xong; hàng đợi → chờ `plan.updated` (reason generated) – vẫn làm mới để thấy trạng thái mới nhất
      if (r.status === 'completed' || r.status === 'failed') invalidate(program);
    },
  });
}

// ----------------------------------------------------------------------------- check-in & điều chỉnh

export function useCheckin(program = PROGRAM) {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: (input: Omit<PlanCheckinInput, 'program'>) => submitCheckin({ ...input, program }),
    onSuccess: () => invalidate(program),
  });
}

export function useInstructAdjust(program = PROGRAM) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instruction: string) => instructAdjust(program, instruction),
    onSuccess: ({ proposal }) => {
      qc.setQueryData<PlanAdjustProposal[]>(planKeys.proposals(program), (list) => [proposal, ...(list ?? []).filter((p) => p.proposal_id !== proposal.proposal_id)]);
      void qc.invalidateQueries({ queryKey: planKeys.proposals(program) });
      void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
    },
  });
}

export function useApplyProposal(program = PROGRAM) {
  const qc = useQueryClient();
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: (proposalId: string) => applyProposal(proposalId),
    onSuccess: ({ proposal }) => {
      qc.setQueryData<PlanAdjustProposal[]>(planKeys.proposals(program), (list) => (list ?? []).map((p) => (p.proposal_id === proposal.proposal_id ? proposal : p)));
      invalidate(program);
    },
    onError: () => invalidate(program),
  });
}

/** Đề xuất còn "sống" (chưa áp dụng/hết hạn/thay thế) – hiện trên đầu trang lộ trình */
export const ACTIVE_PROPOSAL_STATUSES: ReadonlySet<PlanAdjustProposal['status']> = new Set(['pending', 'ready', 'needs_clarification', 'rejected', 'failed']);
