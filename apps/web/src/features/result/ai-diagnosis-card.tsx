'use client';

import * as React from 'react';
import { Bot, Check, ListChecks, Lock, Quote, RotateCcw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Alert, AlertDescription, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Skeleton } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useFlag } from '@/features/flags/flags-provider';
import { aiErrorToApiError, streamPreview } from '@/lib/ai-stream';
import { getErrorCode } from '@/lib/errors';
import { needsUpgrade } from '@/lib/quota';
import type { AttemptAiDiagnosis } from '@/lib/types';
import { useSectionLabel } from '@/features/attempt/section-label';
import { CreditsNotice, QuotaExceededNotice, UPGRADE_HREF, useQuota } from '@/features/quota/quota-ui';
import { checkAnswerIndex } from './diagnosis';
import { DIAGNOSIS_PREVIEW_FIELDS, useAiDiagnosis } from './use-ai-diagnosis';

const AI_DIAGNOSE = 'ai_diagnose';

/** `part5:word_form` → "Part 5 · Dạng từ"; mã khác giữ nguyên (đầu ra AI, không phải chuỗi UI) */
function useErrorTypeLabel(): (code: string) => string {
  const tr = useTranslations('result');
  const tq = useTranslations('questionTypes');
  const section = useSectionLabel();
  return (code) => {
    const m = /^([a-z0-9_]+):(.+)$/.exec(code);
    if (!m) return code;
    const [, sec, rest] = m as unknown as [string, string, string];
    const restLabel = tr.has(`subskills.${rest}` as never) ? tr(`subskills.${rest}` as never) : tq.has(rest as never) ? tq(rest as never) : rest.replace(/[-_]+/g, ' ');
    return `${section(sec, { short: true })} · ${restLabel}`;
  };
}

/**
 * Khối "Phân tích của AI" trên màn kết quả (Sprint 5, `diagnose_rl`, Pro): nút tạo → SSE, hiển thị dạng sai nhiều nhất,
 * bằng chứng, lý do, 3 bước, câu tự kiểm tra, lời động viên; tải lại đọc GET. Free → thẻ khoá + CTA nâng cấp.
 * Khối chẩn đoán theo quy tắc (Sprint 3) vẫn hiển thị riêng phía trên.
 */
export function AiDiagnosisCard({ attemptId }: { attemptId: string }) {
  const t = useTranslations('result');
  const te = useTranslations('errors');
  const fmt = useFormatter();
  const ctl = useAiDiagnosis(attemptId);
  // S11: kill-switch ff.ai.diagnose tắt → ẩn thẻ (phân tích đã tạo trước đó vẫn hiện, không cho tạo mới)
  const enabled = useFlag('ff.ai.diagnose');
  const { features, credits, isPending: entPending } = useQuota(AI_DIAGNOSE);
  const canUse = features.includes(AI_DIAGNOSE);
  const { stream, data } = ctl;
  const live = stream.status === 'connecting' || stream.status === 'streaming';
  const err = stream.status === 'error' && stream.error ? aiErrorToApiError(stream.error) : null;
  const code = stream.error?.code ?? null;

  let body: React.ReactNode;
  let state: string;
  if (!enabled && !data && !live) return null;
  if (data) {
    state = 'ready';
    body = <DiagnosisView data={data} />;
  } else if (live) {
    state = 'streaming';
    const preview = streamPreview(stream.text, DIAGNOSIS_PREVIEW_FIELDS);
    body = (
      <div className="space-y-3" aria-busy data-testid="ai-diagnosis-stream" data-chars={stream.text.length}>
        <p className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="size-4 animate-pulse text-accent" aria-hidden />
          {t('aiDiagnosisStreaming')}
        </p>
        {preview.text ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {preview.text}
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground align-middle" aria-hidden />
          </p>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}
      </div>
    );
  } else if (ctl.loading || entPending) {
    state = 'loading';
    body = (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  } else if ((err && needsUpgrade(err)) || (!err && !canUse)) {
    state = 'locked';
    body = <LockedBody />;
  } else if (err && code === 'quota_exceeded') {
    state = 'error';
    body = <QuotaExceededNotice error={err} />;
  } else if (err && code === 'insufficient_credits') {
    state = 'error';
    body = <CreditsNotice error={err} />;
  } else if (err && code === 'exam_mode_locked') {
    state = 'exam-locked';
    body = (
      <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="ai-diagnosis-exam-locked">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('aiDiagnosisExamLocked')}
      </p>
    );
  } else if (err) {
    state = 'error';
    body = (
      <Alert variant="destructive" data-testid="ai-diagnosis-error" data-code={code ?? ''}>
        <TriangleAlert aria-hidden />
        <AlertDescription>
          <p>{code === 'conflict' ? t('aiDiagnosisConflict') : code === 'ai_failed' || code === 'ai_timeout' ? t('aiDiagnosisError') : te(`codes.${getErrorCode(err)}`)}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={ctl.generate} data-testid="ai-diagnosis-retry">
            <RotateCcw aria-hidden />
            {t('aiDiagnosisRetry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  } else {
    state = 'idle';
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="gold" onClick={ctl.generate} data-testid="ai-diagnosis-generate">
          <Sparkles aria-hidden />
          {t('aiDiagnosisGenerate')}
        </Button>
        {credits !== null ? <span className="text-xs text-muted-foreground">{t('aiDiagnosisCredits', { count: credits })}</span> : null}
        {ctl.loadError ? <span className="text-xs text-muted-foreground">{t('aiDiagnosisLoadError')}</span> : null}
      </div>
    );
  }

  return (
    <Card data-testid="ai-diagnosis" data-state={state} className={cn(state === 'locked' && 'border-dashed')}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5 text-primary dark:text-accent" aria-hidden />
              {t('aiDiagnosisTitle')}
              <Badge variant="gold">Pro</Badge>
            </CardTitle>
            <CardDescription>{t('aiDiagnosisSubtitle')}</CardDescription>
          </div>
          {data ? (
            <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
              {data.cached ? (
                <Badge variant="outline" data-testid="ai-diagnosis-cached">
                  {t('aiDiagnosisCached')}
                </Badge>
              ) : null}
              {data.created_at && !Number.isNaN(Date.parse(data.created_at)) ? <span>{t('aiDiagnosisCreatedAt', { date: fmt.dateTime(new Date(data.created_at), { dateStyle: 'medium', timeStyle: 'short' }) })}</span> : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent aria-live="polite">{body}</CardContent>
    </Card>
  );
}

function LockedBody() {
  const t = useTranslations('result');
  const tq = useTranslations('quota');
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/60 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="ai-diagnosis-locked">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">{t('aiDiagnosisLockedTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('aiDiagnosisLockedDesc')}</p>
        </div>
      </div>
      <Link href={UPGRADE_HREF} className={cn(buttonVariants({ variant: 'gold', size: 'sm' }), 'shrink-0')} data-testid="upgrade-cta">
        {tq('upgradeCta')}
      </Link>
    </div>
  );
}

function DiagnosisView({ data }: { data: AttemptAiDiagnosis }) {
  const t = useTranslations('result');
  const label = useErrorTypeLabel();
  return (
    <div className="space-y-5 text-sm leading-relaxed" data-testid="ai-diagnosis-result" lang={data.locale}>
      <div className="rounded-lg bg-accent/15 px-4 py-3">
        <p className="text-xs font-semibold text-muted-foreground">{t('aiDiagnosisTopError')}</p>
        <p className="text-lg font-bold" data-testid="ai-diagnosis-top-error" data-code={data.top_error_type}>
          {label(data.top_error_type)}
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="space-y-2">
          <h3 className="font-semibold">{t('aiDiagnosisEvidence')}</h3>
          <ul className="space-y-2" data-testid="ai-diagnosis-evidence">
            {data.evidence.map((e, i) => (
              <li key={i} className="flex gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <Quote className="mt-0.5 size-4 shrink-0 text-accent-foreground dark:text-accent" aria-hidden />
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold">{t('aiDiagnosisWhy')}</h3>
          <p data-testid="ai-diagnosis-why">{data.why}</p>
        </section>
      </div>
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <ListChecks className="size-4" aria-hidden />
          {t('aiDiagnosisSteps')}
        </h3>
        <ol className="grid gap-2 sm:grid-cols-3" data-testid="ai-diagnosis-steps">
          {data.steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-border bg-card p-3">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-navy-foreground">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>
      <CheckQuestion q={data.check_question} />
      <p className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 font-medium" data-testid="ai-diagnosis-encouragement">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        {data.encouragement}
      </p>
      <p className="text-xs text-muted-foreground">{t('aiDiagnosisDisclaimer')}</p>
    </div>
  );
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** Câu tự kiểm tra: chọn một lựa chọn → đúng/sai + giải thích ngắn (đáp án có thể là chữ cái hoặc nguyên văn lựa chọn) */
function CheckQuestion({ q }: { q: AttemptAiDiagnosis['check_question'] }) {
  const t = useTranslations('result');
  const [picked, setPicked] = React.useState<number | null>(null);
  const correctIndex = checkAnswerIndex(q.options, q.answer);
  const answerText = correctIndex >= 0 ? q.options[correctIndex]! : q.answer;
  return (
    <section className="space-y-2 rounded-lg border border-border p-4" data-testid="ai-diagnosis-check">
      <h3 className="font-semibold">{t('aiDiagnosisCheck')}</h3>
      <p className="font-medium">{q.stem}</p>
      <p className="text-xs text-muted-foreground">{t('aiDiagnosisCheckHint')}</p>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('aiDiagnosisCheck')}>
        {q.options.map((o, i) => {
          const chosen = picked === i;
          const isRight = i === correctIndex;
          return (
            <button
              key={`${i}-${o}`}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={picked !== null}
              onClick={() => setPicked(i)}
              data-testid={`ai-check-option-${i}`}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default',
                picked === null && 'hover:bg-muted',
                picked !== null && isRight && 'border-success bg-success/10',
                chosen && !isRight && 'border-destructive bg-destructive/5',
              )}
            >
              <span className="omr-bubble size-6 shrink-0 text-xs">{LETTERS[i]}</span>
              <span className="flex-1">{o}</span>
              {picked !== null && isRight ? <Check className="size-4 text-success" aria-hidden /> : null}
              {chosen && !isRight ? <X className="size-4 text-destructive" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      {picked !== null ? (
        <p className="text-sm" data-testid="ai-check-feedback" data-correct={picked === correctIndex} aria-live="polite">
          <span className={cn('font-semibold', picked === correctIndex ? 'text-success' : 'text-destructive')}>{picked === correctIndex ? t('aiDiagnosisCheckCorrect') : t('aiDiagnosisCheckWrong', { answer: answerText })}</span> {q.explanation}
        </p>
      ) : null}
    </section>
  );
}
