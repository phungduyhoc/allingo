'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, CheckCircle2, Dumbbell, Layers, Volume2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { pickLocalized, type LocalizedText, type VocabItem } from '@allingo/schemas';
import { Badge, Button, buttonVariants, Card, CardContent, Spinner } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { Markdown } from '@/components/markdown';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { useLocalized } from '@/lib/localized';
import { getLesson, getVocabListItems } from '@/lib/plan-api';
import { PROGRAM, usePatchTask } from './queries';

/**
 * Màn nội dung của task tự báo (S9): bài học `/lessons/{id}?task=` và bộ từ `/vocab/{id}?task=`. Học xong → "Đánh dấu xong"
 * (PATCH /plan-tasks/{id} done + result_ref) → về Hôm nay; server cộng XP việc tự báo và tính ngày học. Màn ôn SRS đầy đủ ở S10.
 */

function useCompleteTask(resultRef: { lesson_id?: string }) {
  const t = useTranslations('taskContent');
  const search = useSearchParams();
  const taskId = search.get('task');
  const router = useRouter();
  const patch = usePatchTask(PROGRAM);
  const complete = () => {
    if (!taskId) return;
    patch.mutate(
      { taskId, patch: { status: 'done', ...(resultRef.lesson_id ? { result_ref: { lesson_id: resultRef.lesson_id } } : {}) } },
      {
        onSuccess: () => {
          toast.success(t('completed'));
          router.push('/toeic/today');
        },
      },
    );
  };
  return { taskId, complete, pending: patch.isPending, error: patch.error };
}

function CompleteBar({ taskId, onComplete, pending, label }: { taskId: string | null; onComplete: () => void; pending: boolean; label: string }) {
  const t = useTranslations('taskContent');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <Link href="/toeic/today" className={buttonVariants({ variant: 'ghost' })}>
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

function meaningOf(item: VocabItem, locale: string): string | null {
  const m: unknown = item.meanings;
  if (!m) return null;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) {
    const first = m[0] as unknown;
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const o = first as Record<string, unknown>;
      const v = o[locale] ?? o.vi ?? o.en ?? o.text ?? o.meaning;
      return typeof v === 'string' ? v : null;
    }
    return null;
  }
  if (typeof m === 'object') {
    const o = m as Record<string, unknown>;
    const v = o[locale] ?? o.vi ?? o.en;
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  }
  return null;
}

export function VocabListPage({ listId }: { listId: string }) {
  const t = useTranslations('taskContent');
  const locale = useLocale();
  const items = useQuery({ queryKey: ['vocab', 'lists', listId, 'items'], queryFn: () => getVocabListItems(listId) });
  const done = useCompleteTask({});
  const [revealed, setRevealed] = React.useState<Set<string>>(new Set());
  if (items.isPending) return <CardSkeleton lines={6} />;
  if (items.isError) return <ErrorState error={items.error} onRetry={() => void items.refetch()} />;
  const list = items.data.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="vocab-list-page">
      <PageHeader title={t('vocabTitle')} description={t('vocabDesc', { count: list.length })} />
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.map((w) => {
          const shown = revealed.has(w.id);
          return (
            <li key={w.id}>
              <button
                type="button"
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
                aria-expanded={shown}
                onClick={() => setRevealed((s) => new Set(s).add(w.id))}
                data-testid="vocab-item"
              >
                <Layers className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 space-y-0.5">
                  <span className="block font-semibold">
                    {w.headword}
                    {w.pos ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{w.pos}</span> : null}
                  </span>
                  {w.ipa_us || w.ipa_uk ? <span className="block text-xs text-muted-foreground">/{w.ipa_us ?? w.ipa_uk}/</span> : null}
                  <span className="block text-sm text-muted-foreground">{shown ? (meaningOf(w, locale) ?? '—') : t('tapToReveal')}</span>
                </span>
                {w.audio_us_url ? <Volume2 className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <CompleteBar taskId={done.taskId} onComplete={done.complete} pending={done.pending} label={t('markVocabDone')} />
    </div>
  );
}
