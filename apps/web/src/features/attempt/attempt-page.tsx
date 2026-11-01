'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, CloudOff, Flag, LayoutGrid } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, Badge, Button, buttonVariants, cn, Dialog, DialogContent, DialogHeader, DialogTitle, Separator, Skeleton } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { sendAttemptEvent, useAttempt, useSubmitAttempt } from '@/lib/queries';
import { useLocalized } from '@/lib/localized';
import { asPublicContent, type AnswerInput, type Attempt, type QuestionPublic } from '@/lib/types';
import { ErrorState } from '@/components/states';
import { AudioPlayer } from './audio-player';
import { ExamHeader } from './exam-header';
import { QuestionGrid } from './question-grid';
import { QuestionRenderer } from './question-renderer';
import { SubmitDialog } from './submit-dialog';
import { useDraftSaver } from './use-draft-saver';
import { useExamClock } from './use-exam-clock';
import { answerOrEmpty, attemptReducer, countUnanswered, initialAttemptState, isAnswered } from './attempt-state';

export function AttemptPage({ attemptId }: { attemptId: string }) {
  const t = useTranslations('attempt');
  const query = useAttempt(attemptId, { refetchOnMount: 'always', staleTime: 0 });

  if (query.isPending) {
    return (
      <div className="min-h-dvh bg-background">
        <div className="h-14 bg-navy" />
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState error={query.error} title={t('loadError')} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (query.data.status !== 'in_progress') {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <p className="text-lg font-semibold">{t('alreadySubmitted')}</p>
        <Link href={`/attempts/${attemptId}/result`} className={buttonVariants({ variant: 'navy' })}>
          {t('viewResult')}
        </Link>
      </div>
    );
  }
  return <AttemptRunner attempt={query.data} />;
}

const AUDIO_KEY = (attemptId: string) => `allingo.audio.${attemptId}`;

function AttemptRunner({ attempt }: { attempt: Attempt }) {
  const t = useTranslations('attempt');
  const ts = useTranslations('sections');
  const L = useLocalized();
  const router = useRouter();
  const isExam = attempt.mode !== 'practice';
  const questions = React.useMemo(() => [...attempt.questions].sort((a, b) => a.order_no - b.order_no), [attempt.questions]);

  const saver = useDraftSaver(attempt.id, true);
  const [state, dispatch] = React.useReducer(attemptReducer, undefined, () => initialAttemptState(attempt, saver.queue.pendingEntries()));
  const current = questions[state.currentIndex] ?? questions[0]!;
  const content = asPublicContent(current.content);
  const currentAnswer = state.answers[current.question_id] ?? null;

  // Thời gian trên câu hiện tại & section (để time_spent_ms và section_elapsed_sec); mốc đặt trong effect (không gọi Date.now() khi render)
  const enteredAtRef = React.useRef(0);
  const loadedAtRef = React.useRef(0);
  React.useEffect(() => {
    const now = Date.now();
    enteredAtRef.current = now;
    loadedAtRef.current = now;
  }, []);
  const sectionBase = React.useMemo(() => Object.fromEntries(attempt.sections.map((s) => [s.section_code, s.elapsed_sec])), [attempt.sections]);
  const sectionElapsed = React.useCallback(() => {
    const code = current.section_code;
    return { [code]: (sectionBase[code] ?? 0) + Math.floor((Date.now() - loadedAtRef.current) / 1000) };
  }, [current.section_code, sectionBase]);
  const [gridOpen, setGridOpen] = React.useState(false);

  // Audio đã phát (Exam Mode phát một lần) – nhớ qua localStorage để tải lại không phát lại
  const [playedAudio, setPlayedAudio] = React.useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(AUDIO_KEY(attempt.id)) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const markPlayed = (qid: string) => {
    setPlayedAudio((prev) => {
      const next = new Set(prev).add(qid);
      try {
        window.localStorage.setItem(AUDIO_KEY(attempt.id), JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
    sendAttemptEvent(attempt.id, { type: 'audio_played', meta: { question_id: qid } });
  };

  const setAnswer = React.useCallback(
    (answer: AnswerInput) => {
      dispatch({ type: 'answer', questionId: current.question_id, answer });
      saver.enqueue({ question_id: current.question_id, answer, flagged: state.flags[current.question_id] });
    },
    [current.question_id, saver, state.flags],
  );

  const toggleFlag = React.useCallback(() => {
    const flagged = !state.flags[current.question_id];
    dispatch({ type: 'flag', questionId: current.question_id, flagged });
    saver.enqueue({ question_id: current.question_id, answer: answerOrEmpty(current, state.answers), flagged });
  }, [current, saver, state.answers, state.flags]);

  const goTo = React.useCallback(
    (index: number) => {
      if (index < 0 || index >= questions.length || index === state.currentIndex) return;
      const delta = Date.now() - enteredAtRef.current;
      if (delta >= 500 && (isAnswered(state.answers[current.question_id]) || delta >= 3000)) {
        saver.enqueue({ question_id: current.question_id, answer: answerOrEmpty(current, state.answers), time_spent_ms: delta });
      }
      const next = questions[index]!;
      saver.setMeta({ ui_state: { current_question_id: next.question_id, current_section_code: next.section_code }, section_elapsed_sec: sectionElapsed() });
      enteredAtRef.current = Date.now();
      dispatch({ type: 'goto', index });
      void saver.flushNow();
      setGridOpen(false);
    },
    [current, questions, saver, sectionElapsed, state.answers, state.currentIndex],
  );

  // Nộp bài
  const submit = useSubmitAttempt(attempt.id);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [forced, setForced] = React.useState(false);
  const doSubmit = React.useCallback(async () => {
    saver.setMeta({ section_elapsed_sec: sectionElapsed() });
    await saver.flushNow();
    submit.mutate(undefined, {
      onSuccess: () => {
        saver.queue.clear();
        router.replace(`/attempts/${attempt.id}/result`);
      },
    });
  }, [attempt.id, router, saver, sectionElapsed, submit]);

  const clock = useExamClock(isExam ? attempt.expires_at : null, attempt.server_time, () => {
    // Hết giờ → tự nộp với các câu đã trả lời
    setForced(true);
    setSubmitOpen(true);
    sendAttemptEvent(attempt.id, { type: 'section_timeout', meta: { section_code: current.section_code } });
    void doSubmit();
  });

  // Sự kiện rời tab / quay lại
  React.useEffect(() => {
    const onVis = () => sendAttemptEvent(attempt.id, { type: document.visibilityState === 'hidden' ? 'tab_leave' : 'resume' });
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [attempt.id]);

  // Phím tắt: 1–4 / A–D chọn đáp án, ← → chuyển câu, F đánh dấu
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (submitOpen || gridOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(state.currentIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(state.currentIndex - 1);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFlag();
      } else if (content && (content.type === 'mcq_single' || content.type === 'mcq_multi')) {
        const k = e.key.toUpperCase();
        const idx = /^[1-9]$/.test(k) ? Number(k) - 1 : /^[A-J]$/.test(k) ? k.charCodeAt(0) - 65 : -1;
        const opt = idx >= 0 ? content.options[idx] : undefined;
        if (!opt) return;
        e.preventDefault();
        if (content.type === 'mcq_single') {
          setAnswer({ type: 'mcq_single', selected: opt.key });
        } else {
          const sel = new Set(currentAnswer?.type === 'mcq_multi' ? currentAnswer.selected : []);
          if (sel.has(opt.key)) sel.delete(opt.key);
          else sel.add(opt.key);
          setAnswer({ type: 'mcq_multi', selected: content.options.filter((o) => sel.has(o.key)).map((o) => o.key) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [content, currentAnswer, goTo, gridOpen, setAnswer, state.currentIndex, submitOpen, toggleFlag]);

  const gridItems = React.useMemo(
    () => questions.map((q, i) => ({ questionId: q.question_id, number: i + 1, answered: isAnswered(state.answers[q.question_id]), flagged: !!state.flags[q.question_id] })),
    [questions, state.answers, state.flags],
  );
  const unanswered = countUnanswered(questions, state.answers);
  const title = attempt.test_set && typeof attempt.test_set === 'object' && 'title' in attempt.test_set ? L(attempt.test_set.title as Record<string, string>) : t('examTitle');
  const sectionLabel = sectionName(ts, current.section_code);
  const audio = current.media.find((m) => m.kind === 'audio');
  const listenPolicy = content && 'media' in content && content.media?.listen_policy === 'once' && isExam ? 'once' : 'free';
  const flagged = !!state.flags[current.question_id];

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ExamHeader
        title={title}
        sectionLabel={sectionLabel}
        mode={attempt.mode}
        remaining={clock.remaining}
        tone={clock.tone}
        announcement={clock.announcement}
        saveStatus={saver.status}
        pending={saver.pending}
        onSubmit={() => setSubmitOpen(true)}
        submitting={submit.isPending}
      />

      {saver.status === 'offline' ? (
        <div className="border-b border-accent/50 bg-accent/15" role="status">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-sm sm:px-5">
            <CloudOff className="size-4 shrink-0" aria-hidden />
            {t('offlineQueued')}
          </div>
        </div>
      ) : null}

      <div className="mx-auto grid w-full max-w-7xl flex-1 content-start items-start gap-6 px-3 py-5 pb-28 sm:px-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:pb-8">
        <div className={cn('grid content-start items-start gap-5', current.passage ? 'xl:grid-cols-2' : '')}>
          {current.passage ? (
            <section aria-label={t('passageTitle')} className="rounded-xl border border-border bg-card p-5 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto">
              {current.passage.title ? <h2 className="mb-3 text-base font-semibold">{current.passage.title}</h2> : null}
              <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{current.passage.body}</div>
            </section>
          ) : null}

          <section aria-labelledby={`q-${current.question_id}-stem`} className="rounded-xl border border-border bg-card p-5 sm:p-6" data-testid="question-card">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="tabular text-sm font-semibold text-muted-foreground">{t('questionOf', { current: state.currentIndex + 1, total: questions.length })}</span>
                {!isExam ? <Badge variant="secondary">{t('practiceTitle')}</Badge> : null}
              </div>
              <Button variant={flagged ? 'gold' : 'outline'} size="sm" onClick={toggleFlag} aria-pressed={flagged} data-testid="flag-button">
                <Flag className={cn(flagged && 'fill-current')} aria-hidden />
                {flagged ? t('flagged') : t('flag')}
              </Button>
            </div>

            {audio ? (
              <AudioPlayer
                key={current.question_id}
                src={audio.url}
                policy={listenPolicy}
                played={playedAudio.has(current.question_id)}
                onPlayed={() => markPlayed(current.question_id)}
                onStarted={() => sendAttemptEvent(attempt.id, { type: 'audio_started', meta: { question_id: current.question_id } })}
                autoPlay={false}
                className="mb-4"
              />
            ) : null}

            {content?.stem && content.type !== 'fill_blank' ? (
              <p id={`q-${current.question_id}-stem`} className="mb-5 text-lg leading-relaxed font-medium">
                {content.stem}
              </p>
            ) : (
              <span id={`q-${current.question_id}-stem`} className="sr-only">
                {t('questionNumber', { number: state.currentIndex + 1 })}
              </span>
            )}

            {content ? <QuestionRenderer questionId={current.question_id} content={content} answer={currentAnswer} onChange={setAnswer} disabled={submit.isPending || clock.expired} /> : null}

            {!isExam ? (
              // Practice mode: Sprint 0 chưa có endpoint kiểm tra đáp án tức thì (client không được nhận answer_key).
              // Sprint 3 sẽ bổ sung POST /attempts/{id}/check (hoặc tương đương) để hiện đúng/sai ngay sau khi chọn.
              <Alert variant="info" className="mt-5">
                <AlertDescription>{t('practiceSavedHint')}</AlertDescription>
              </Alert>
            ) : null}

            <Separator className="my-5" />
            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" onClick={() => goTo(state.currentIndex - 1)} disabled={state.currentIndex === 0} data-testid="prev-button">
                <ChevronLeft aria-hidden />
                {t('prev')}
              </Button>
              <p className="hidden text-xs text-muted-foreground md:block">{t('keyboardHint')}</p>
              {state.currentIndex < questions.length - 1 ? (
                <Button variant="navy" onClick={() => goTo(state.currentIndex + 1)} data-testid="next-button">
                  {t('next')}
                  <ChevronRight aria-hidden />
                </Button>
              ) : (
                <Button variant="gold" onClick={() => setSubmitOpen(true)} data-testid="next-button">
                  {t('submit')}
                </Button>
              )}
            </div>
          </section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-xl border border-border bg-card p-4">
            <QuestionGrid items={gridItems} currentIndex={state.currentIndex} onSelect={goTo} />
          </div>
        </aside>
      </div>

      {/* Thanh điều hướng mobile */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => goTo(state.currentIndex - 1)} disabled={state.currentIndex === 0} aria-label={t('prev')}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setGridOpen(true)} aria-label={t('gridOpen')}>
            <LayoutGrid aria-hidden />
            <span className="tabular">{t('progress', { answered: questions.length - unanswered, total: questions.length })}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => goTo(state.currentIndex + 1)} disabled={state.currentIndex >= questions.length - 1} aria-label={t('next')}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
      <Dialog open={gridOpen} onOpenChange={setGridOpen} side="bottom">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('gridTitle')}</DialogTitle>
          </DialogHeader>
          <QuestionGrid items={gridItems} currentIndex={state.currentIndex} onSelect={goTo} />
        </DialogContent>
      </Dialog>

      <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} unanswered={unanswered} onConfirm={() => void doSubmit()} submitting={submit.isPending} error={submit.error} forced={forced} />
    </div>
  );
}

function sectionName(ts: ReturnType<typeof useTranslations<'sections'>>, code: string): string | null {
  const known = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7', 'listening', 'reading'] as const;
  return (known as readonly string[]).includes(code) ? ts(code as (typeof known)[number]) : code;
}

export type { QuestionPublic };
