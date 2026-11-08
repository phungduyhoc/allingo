'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, ClipboardCheck, Clock, Gauge, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ApiError } from '@allingo/api-client';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Progress, Spinner } from '@allingo/ui';
import { asPublicContent, type QuestionPublic } from '@/lib/types';
import { getErrorCode } from '@/lib/errors';
import { useMyAttempts } from '@/lib/queries';
import { answerDiagnostic, conflictDetails, getDiagnosticStep, startDiagnostic } from '@/lib/plan-api';
import { ErrorState } from '@/components/states';
import { AudioPlayer } from '@/features/attempt/audio-player';
import { PassagePane } from '@/features/attempt/passage-pane';
import { QuestionRenderer } from '@/features/attempt/question-renderer';
import { QuestionStem } from '@/features/attempt/question-stem';
import { PROGRAM, useInvalidatePlan } from '@/features/plan/queries';
import { answerBody, currentQuestionId, diagnosticProgress, diagnosticReducer, initialDiagnosticState, MAX_RESYNCS } from './diagnostic-state';
import { DiagnosticResultView } from './diagnostic-result';

const DIRECTION_SECTIONS = new Set(['part1', 'part2']);

/**
 * Bài chẩn đoán thích ứng `/toeic/diagnostic` (S9, ADR-0031): một câu mỗi màn, thanh tiến độ + mức hiện tại, không hiện đúng/sai.
 * Câu Listening dùng trình phát tự do của Practice (A-S9-W1: bài chẩn đoán ngắn, mỗi màn một câu – không chuỗi "nghe một lần";
 * URL ký 10′ lỗi → GET lại câu đang chờ để có URL mới). Tải lại trang → tiếp tục đúng câu đang chờ (GET …/next).
 */
export function DiagnosticPage() {
  const t = useTranslations('diagnostic');
  const te = useTranslations('errors');
  const search = useSearchParams();
  const fromOnboarding = search.get('from') === 'onboarding';
  const [state, dispatch] = React.useReducer(diagnosticReducer, initialDiagnosticState);
  const [attemptId, setAttemptId] = React.useState<string | null>(null);
  const inProgress = useMyAttempts({ program: PROGRAM, mode: 'diagnostic', status: 'in_progress' });
  const graded = useMyAttempts({ program: PROGRAM, mode: 'diagnostic', status: 'graded' });
  const resumeId = inProgress.data?.data[0]?.id ?? null;
  const lastGradedId = graded.data?.data[0]?.id ?? null;
  const invalidate = useInvalidatePlan();
  const autoStarted = React.useRef(false);
  const mediaRetried = React.useRef<string | null>(null);

  const load = React.useCallback(async (fn: () => Promise<Awaited<ReturnType<typeof startDiagnostic>>>) => {
    dispatch({ type: 'load' });
    try {
      const step = await fn();
      setAttemptId(step.attempt_id);
      dispatch({ type: 'loaded', step, at: Date.now() });
      if (step.done) invalidate(PROGRAM);
    } catch (err) {
      dispatch({ type: 'failed', error: err });
    }
  }, [invalidate]);

  const start = React.useCallback(() => void load(() => (resumeId ? getDiagnosticStep(resumeId) : startDiagnostic(PROGRAM))), [load, resumeId]);

  // Có bài dở hoặc vừa bấm "Bắt đầu" ở onboarding → vào thẳng câu đang chờ
  React.useEffect(() => {
    if (autoStarted.current || state.phase !== 'idle' || inProgress.isPending) return;
    if (!resumeId && !fromOnboarding) return;
    // Gọi API ngoài thân effect (callback) – kết quả cập nhật state khi về
    const id = window.setTimeout(() => {
      autoStarted.current = true;
      start();
    }, 0);
    return () => window.clearTimeout(id);
  }, [fromOnboarding, inProgress.isPending, resumeId, start, state.phase]);

  const submit = React.useCallback(async () => {
    const body = answerBody(state, Date.now());
    if (!body || !attemptId || state.phase !== 'question') return;
    dispatch({ type: 'submit' });
    try {
      const step = await answerDiagnostic(attemptId, body);
      dispatch({ type: 'loaded', step, at: Date.now() });
      if (step.done) invalidate(PROGRAM);
    } catch (err) {
      // 409: câu đang chờ đã khác (bấm đúp / tab khác) hoặc bài đã xong → lấy lại trạng thái server
      if (conflictDetails(err) && state.resyncs < MAX_RESYNCS) {
        dispatch({ type: 'conflict' });
        try {
          const step = await getDiagnosticStep(attemptId);
          dispatch({ type: 'loaded', step, at: Date.now() });
          if (step.done) invalidate(PROGRAM);
        } catch (e2) {
          dispatch({ type: 'failed', error: e2 });
        }
        return;
      }
      dispatch({ type: 'failed', error: err });
    }
  }, [attemptId, invalidate, state]);

  const question = (state.step?.next_question ?? null) as QuestionPublic | null;
  const refreshMedia = React.useCallback(() => {
    const qid = currentQuestionId(state.step);
    if (!attemptId || !qid || mediaRetried.current === qid) return;
    mediaRetried.current = qid;
    void getDiagnosticStep(attemptId)
      .then((step) => dispatch({ type: 'loaded', step, at: Date.now() }))
      .catch(() => undefined);
  }, [attemptId, state.step]);

  if (state.phase === 'done' && state.step?.result) {
    return <DiagnosticResultView result={state.step.result} fromOnboarding={fromOnboarding} />;
  }

  if (state.phase === 'idle') {
    return (
      <div className="mx-auto max-w-2xl space-y-6" data-testid="diagnostic-intro">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="text-muted-foreground">{t('introDesc')}</p>
        </div>
        <Card>
          <CardContent className="space-y-5">
            <ul className="space-y-3 text-sm">
              <li className="flex gap-3">
                <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {t('introTime')}
              </li>
              <li className="flex gap-3">
                <Layers className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {t('introAdaptive')}
              </li>
              <li className="flex gap-3">
                <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {t('introNoFeedback')}
              </li>
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="gold" size="lg" onClick={start} disabled={inProgress.isPending} data-testid="diagnostic-start">
                {resumeId ? t('resume') : t('start')}
                <ArrowRight aria-hidden />
              </Button>
              {lastGradedId && !resumeId ? (
                <Button variant="outline" size="lg" onClick={() => void load(() => getDiagnosticStep(lastGradedId))} data-testid="diagnostic-last-result">
                  {t('lastResult')}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.phase === 'error' || (state.phase === 'done' && !state.step?.result)) {
    return <ErrorState error={state.error ?? new ApiError(500, undefined)} title={t('loadError')} onRetry={start} />;
  }

  if (state.phase === 'loading' && !question) {
    return (
      <div className="flex justify-center py-16" aria-busy>
        <Spinner label={t('loading')} />
      </div>
    );
  }

  const progress = diagnosticProgress(state.step);
  const content = question ? asPublicContent(question.content) : null;
  const audio = question?.media.find((m) => m.kind === 'audio') ?? null;
  const images = question?.media.filter((m) => m.kind === 'image') ?? [];
  const groupAudio = question?.passage?.media_url ?? null;
  const readingPassage = question?.passage && question.passage.kind !== 'audio_script' && question.passage.body ? question.passage : null;
  const direction = question && !content?.stem && DIRECTION_SECTIONS.has(question.section_code) ? question.section_code : null;
  const level = state.step?.progress.level ?? null;
  const stemId = question ? `diag-${question.question_id}-stem` : 'diag-stem';
  const busy = state.phase === 'submitting' || state.phase === 'loading';

  return (
    <DiagnosticQuestionShell
      number={progress.number}
      planned={progress.planned}
      pctValue={progress.pct}
      section={question?.section_code ?? state.step?.progress.section_code ?? null}
      level={level}
      groupRemaining={state.step?.progress.group_remaining ?? 0}
    >
      {question ? (
        <form
          key={question.question_id}
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          data-testid="diagnostic-question"
          data-question-id={question.question_id}
          data-section={question.section_code}
          data-level={level ?? ''}
        >
          {readingPassage ? <PassagePane passage={readingPassage} zoom={1} /> : null}
          <Card>
            <CardContent className="space-y-4">
              {groupAudio ? <AudioPlayer key={`g-${question.passage?.id}`} src={groupAudio} label={t('groupAudio')} onError={refreshMedia} data-testid="diagnostic-group-audio" /> : null}
              {audio ? <AudioPlayer key={audio.id} src={audio.url} compact={!!groupAudio} label={t('questionAudio')} onError={refreshMedia} data-testid="diagnostic-audio" /> : null}
              {images.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element -- ảnh nội dung qua URL ký hết hạn (không tối ưu bằng next/image)
                <img key={m.id} src={m.url} alt={t('imageAlt')} onError={refreshMedia} className="max-h-72 w-full max-w-xl rounded-lg border border-border bg-muted object-contain" />
              ))}
              {content?.stem && content.type !== 'fill_blank' ? (
                <QuestionStem id={stemId} stem={content.stem} className="text-lg leading-relaxed font-medium" />
              ) : direction ? (
                <p id={stemId} className="text-sm text-muted-foreground">
                  {t(`directions.${direction}`)}
                </p>
              ) : (
                <span id={stemId} className="sr-only">
                  {t('questionNumber', { number: progress.number })}
                </span>
              )}
              {content ? <QuestionRenderer questionId={question.question_id} content={content} answer={state.answer} onChange={(answer) => dispatch({ type: 'select', answer })} disabled={busy} /> : null}
            </CardContent>
          </Card>
          {state.error ? (
            <Alert variant="destructive" data-testid="diagnostic-error">
              <AlertDescription>{te(`codes.${getErrorCode(state.error)}`)}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t('noFeedbackHint')}</p>
            <Button type="submit" variant="navy" size="lg" disabled={busy || !state.answer} data-testid="diagnostic-next">
              {busy ? <Spinner className="size-4" /> : null}
              {t('next')}
              <ArrowRight aria-hidden />
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex justify-center py-10">
          <Spinner label={t('loading')} />
        </div>
      )}
    </DiagnosticQuestionShell>
  );
}

function DiagnosticQuestionShell({ number, planned, pctValue, section, level, groupRemaining, children }: { number: number; planned: number; pctValue: number; section: string | null; level: number | null; groupRemaining: number; children: React.ReactNode }) {
  const t = useTranslations('diagnostic');
  const ts = useTranslations('sections');
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="diagnostic-runner">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{t('title')}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {section ? <Badge variant="outline">{ts.has(section) ? ts(section) : section}</Badge> : null}
            {level ? (
              <Badge variant={level >= 2 ? 'gold' : 'secondary'} data-testid="diagnostic-level" data-level={level}>
                <Gauge aria-hidden />
                {t('level', { level })}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={pctValue} label={t('progressLabel')} className="flex-1" />
          <span className="tabular shrink-0 text-sm font-medium" data-testid="diagnostic-progress" data-number={number} data-planned={planned}>
            {t('progress', { number, planned })}
          </span>
        </div>
        {groupRemaining > 0 ? <p className="text-xs text-muted-foreground">{t('groupRemaining', { count: groupRemaining })}</p> : null}
      </div>
      {children}
    </div>
  );
}
