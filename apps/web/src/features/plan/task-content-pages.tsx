'use client';

import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, CheckCircle2, Dumbbell } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { pickLocalized, type LocalizedText } from '@allingo/schemas/common';
import { Badge, Button, buttonVariants, Card, CardContent, Spinner } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { Markdown } from '@/components/markdown';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { useLocalized } from '@/lib/localized';
import { getLesson } from '@/lib/plan-api';
import { usePatchTask } from './queries';
import { useProgram, useProgramHref } from '@/features/program/program-context';

/**
 * Màn nội dung của task tự báo (S9): bài học `/lessons/{id}?task=`. Học xong → "Đánh dấu xong" (PATCH /plan-tasks/{id} done +
 * result_ref) → về Hôm nay; server cộng XP việc tự báo và tính ngày học. Bộ từ `/vocab/{id}` (S9) → S10 thay bằng trang bộ từ
 * thật `/toeic/vocab/{id}` + phiên ôn `features/flashcards`.
 */

function useCompleteTask(resultRef: { lesson_id?: string }) {
  const program = useProgram();
  const href = useProgramHref();
  const t = useTranslations('taskContent');
  const search = useSearchParams();
  const taskId = search.get('task');
  const router = useRouter();
  const patch = usePatchTask(program);
  const complete = () => {
    if (!taskId) return;
    patch.mutate(
      { taskId, patch: { status: 'done', ...(resultRef.lesson_id ? { result_ref: { lesson_id: resultRef.lesson_id } } : {}) } },
      {
        onSuccess: () => {
          toast.success(t('completed'));
          router.push(href('today'));
        },
      },
    );
  };
  return { taskId, complete, pending: patch.isPending, error: patch.error };
}

function CompleteBar({ taskId, onComplete, pending, label }: { taskId: string | null; onComplete: () => void; pending: boolean; label: string }) {
  const href = useProgramHref();
  const t = useTranslations('taskContent');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <Link href={href('today')} className={buttonVariants({ variant: 'ghost' })}>
        <ArrowLeft aria-hidden />
        {t('backToday')}
      </Link>
      {taskId ? (
        <Button variant="gold" onClick={onComplete} disabled={pending} data-testid="task-content-complete">
          {pending ? <Spinner className="size-4" /> : <CheckCircle2 aria-hidden />}
          {label}
        </Button>
      ) : null}
    </div>
  );
}

export function LessonPage({ lessonId }: { lessonId: string }) {
  const t = useTranslations('taskContent');
  const L = useLocalized();
  const locale = useLocale();
  const lesson = useQuery({ queryKey: ['lessons', lessonId], queryFn: () => getLesson(lessonId), staleTime: 5 * 60_000 });
  const done = useCompleteTask({ lesson_id: lessonId });
  if (lesson.isPending) return <CardSkeleton lines={6} />;
  if (lesson.isError) return <ErrorState error={lesson.error} onRetry={() => void lesson.refetch()} />;
  const l = lesson.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="lesson-page">
      <PageHeader title={L(l.title)} description={l.summary ? L(l.summary) : undefined} />
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          <BookOpen aria-hidden />
          {t(`lessonKind.${l.kind}`)}
        </Badge>
        {l.est_minutes ? <Badge variant="outline">{t('minutes', { count: l.est_minutes })}</Badge> : null}
      </div>
      <ol className="space-y-4">
        {l.steps.map((s) => (
          <li key={s.step_no}>
            <Card>
              <CardContent className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">{t('step', { n: s.step_no })}</p>
                {s.type === 'practice' ? (
                  <p className="flex items-center gap-2 text-sm">
                    <Dumbbell className="size-4 text-muted-foreground" aria-hidden />
                    {t('practiceStep', { count: Array.isArray((s.content as { question_ids?: unknown[] } | null)?.question_ids) ? (s.content as { question_ids: unknown[] }).question_ids.length : 0 })}
                  </p>
                ) : (
                  <Markdown source={pickLocalized((s.content ?? {}) as LocalizedText, locale) || String((s.content as { body?: string } | null)?.body ?? '')} className="text-sm leading-relaxed" />
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      <CompleteBar taskId={done.taskId} onComplete={done.complete} pending={done.pending} label={t('markLessonDone')} />
    </div>
  );
}
