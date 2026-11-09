'use client';

import * as React from 'react';
import { Lock, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Skeleton } from '@allingo/ui';
import { aiErrorToApiError, streamPreview } from '@/lib/ai-stream';
import type { Explanation, AnswerInput  } from '@/lib/types';
import { CreditsNotice, QuotaExceededNotice } from '@/features/quota/quota-ui';
import { useFlag } from '@/features/flags/flags-provider';
import { FeatureDisabledNotice } from '@/features/flags/feature-disabled-notice';
import { useErrorMessage } from '@/lib/use-error-message';
import { ExplainFeedback } from './explain-feedback';
import { explanationKey } from './feedback-memory';
import { EXPLAIN_PREVIEW_FIELDS, useExplain } from './use-explain';

export interface ExplainPanelProps {
  questionVersionId: string;
  chosenOption?: string;
  /** C2: câu trả lời dạng nhiều mục (TFNG, nối, điền từ…) – cá nhân hoá giải thích */
  answer?: AnswerInput | null;
  attemptId: string;
  initial: Explanation | null;
  /** Đang có bài thi Exam Mode chưa nộp (biết trước qua /me/attempts hoặc sau một 403) → ẩn nút giải thích */
  examLocked?: boolean;
  onExamLocked?: () => void;
}

/**
 * Giải thích AI trong Review (Sprint 5): bấm → POST /ai/explain; SSE hiện chữ dần từ `delta` (trích trường văn bản nếu model
 * stream JSON), `result` thay bằng nội dung có cấu trúc; cache → nhãn "Giải thích có sẵn". Lỗi AI → thông báo + Thử lại;
 * 429/402 → số lượt còn lại, giờ reset (giờ VN) + CTA nâng cấp; 403 Exam Mode → ẩn nút. Đánh giá 👍/👎/Sai ở cuối.
 */
export function ExplainPanel({ questionVersionId, chosenOption, answer, attemptId, initial, examLocked = false, onExamLocked }: ExplainPanelProps) {
  const t = useTranslations('review');
  const errorMessage = useErrorMessage();
  // S11: kill-switch ff.ai.explain tắt → ẩn nút (giải thích đã hiện vẫn giữ); server vẫn trả 503 nếu gọi
  const enabled = useFlag('ff.ai.explain');
  const { state, run, resolveTaskId } = useExplain(initial);
  const input = React.useMemo(() => ({ question_version_id: questionVersionId, chosen_option: chosenOption, attempt_id: attemptId, ...(answer && answer.type !== 'mcq_single' ? { answer } : {}) }), [answer, attemptId, chosenOption, questionVersionId]);
  const start = () => void run(input);
  const errorCode = state.error?.code ?? null;

  React.useEffect(() => {
    if (errorCode === 'exam_mode_locked') onExamLocked?.();
  }, [errorCode, onExamLocked]);

  const locked = (examLocked && state.status !== 'done') || errorCode === 'exam_mode_locked';
  if (locked) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="explain-locked">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('explainLockedHint')}
      </p>
    );
  }

  // S11: lần trước bị kill-switch (503) mà cờ đã bật lại → cho bấm lại như chưa giải thích
  const killedBefore = state.status === 'error' && state.error?.code === 'feature_disabled';
  if (state.status === 'idle' || (killedBefore && enabled)) {
    if (!enabled) return null;
    return (
      <Button variant="gold" size="sm" onClick={start} data-testid="explain-button">
        <Sparkles aria-hidden />
        {t('explain')}
      </Button>
    );
  }

  if (state.status === 'error' && state.error) {
    const err = aiErrorToApiError(state.error);
    if (state.error.code === 'quota_exceeded') return <QuotaExceededNotice error={err} testId="explain-quota" />;
    if (state.error.code === 'insufficient_credits') return <CreditsNotice error={err} />;
    if (state.error.code === 'feature_disabled' || !enabled) return <FeatureDisabledNotice flag="ff.ai.explain" />;
    return (
      <Alert variant="destructive" data-testid="explain-error" data-code={state.error.code}>
        <TriangleAlert aria-hidden />
        <AlertTitle>{t('explainErrorTitle')}</AlertTitle>
        <AlertDescription>
          {errorMessage(err)}
          <div className="mt-2">
            <Button variant="outline" size="sm" onClick={start} data-testid="explain-retry">
              <RotateCcw aria-hidden />
              {t('explainRetry')}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const d = state.data;
  const live = state.status === 'connecting' || state.status === 'streaming';
  const preview = live ? streamPreview(state.text, EXPLAIN_PREVIEW_FIELDS) : null;
  return (
    <div className="rounded-xl border border-accent/60 bg-accent/10 p-4" data-testid="explanation" data-status={state.status} data-cached={state.cached} aria-live="polite" aria-busy={live}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-accent-foreground dark:text-accent" aria-hidden />
        <span className="font-semibold">{t('explanationTitle')}</span>
        {live ? <Badge variant="muted">{state.status === 'connecting' ? t('explainConnecting') : t('explainStreaming')}</Badge> : null}
        {!live && state.cached ? (
          <Badge variant="outline" data-testid="explain-cached-badge">
            {t('cachedBadge')}
          </Badge>
        ) : null}
      </div>

      {live ? (
        preview && preview.text ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="explain-stream" data-chars={state.text.length}>
            {preview.text}
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground align-middle" aria-hidden />
          </p>
        ) : (
          <div className="space-y-2" data-testid="explain-stream" data-chars={state.text.length}>
            <Skeleton className="h-3 w-11/12 bg-accent/30" />
            <Skeleton className="h-3 w-4/5 bg-accent/30" />
            <Skeleton className="h-3 w-2/3 bg-accent/30" />
          </div>
        )
      ) : d ? (
        <div className="space-y-3 text-sm leading-relaxed" data-testid="explanation-body">
          <Section title={t('whyCorrect')}>
            <span className="omr-bubble mr-2 size-6 text-xs">{d.correct_option}</span>
            {d.why_correct}
          </Section>
          {Object.keys(d.why_others_wrong).length ? (
            <Section title={t('whyOthersWrong')}>
              <ul className="space-y-1">
                {Object.entries(d.why_others_wrong).map(([k, v]) => (
                  <li key={k} className="flex gap-2">
                    <span className="omr-bubble size-6 shrink-0 text-xs">{k}</span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {d.chosen_option_trap ? <Section title={t('chosenTrap')}>{d.chosen_option_trap}</Section> : null}
          <Section title={t('howToSpot')}>{d.how_to_spot}</Section>
          {d.tested_point ? <Section title={t('testedPoint')}>{d.tested_point}</Section> : null}
          {d.key_vocab?.length ? (
            <Section title={t('keyVocab')}>
              <ul className="flex flex-wrap gap-2">
                {d.key_vocab.map((v) => (
                  <li key={v.term} className="rounded-md border border-border bg-card px-2 py-1">
                    <span className="font-semibold">{v.term}</span>
                    {v.reading ? <span className="text-muted-foreground"> {v.reading}</span> : null}
                    <span className="text-muted-foreground"> — {v.meaning}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {d.related_points.length ? (
            <Section title={t('relatedPoints')}>
              <ul className="flex flex-wrap gap-1.5">
                {d.related_points.map((p, i) => (
                  <li key={`${p.type}-${p.code ?? p.ref_id ?? i}`}>
                    <Badge variant="secondary">{p.label}</Badge>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <ExplainFeedback aiTaskId={state.aiTaskId} contentKey={explanationKey(questionVersionId, chosenOption, d.locale, d.prompt_version_id)} resolveTaskId={() => resolveTaskId(input)} />
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">{title}</p>
      <div>{children}</div>
    </div>
  );
}
