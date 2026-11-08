'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@allingo/ui';
import { PassageTabs, partsOf } from '@/features/attempt/passage-pane';
import { ShortId, When } from '@/features/admin/ui';
import type { AutoCheck, DuplicateInfo, ReviewQueueItem } from '@/lib/content-tools-api';

/** Nội dung câu (bản đang soạn – nhân sự nội dung xem cả answer_key/giải thích) */
interface McqContent {
  type?: string;
  stem?: string;
  options?: Array<{ key: string; text: string }>;
  answer_key?: { correct?: string | string[] };
  explanation?: Record<string, string | undefined>;
  evidence?: string;
}

export const pctOf = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

/** Thông điệp kiểm tra tự động theo mã (i18n) */
export function useCheckText() {
  const t = useTranslations('contentTools');
  return (c: AutoCheck) => (t.has(`checks.${c.code}`) ? t(`checks.${c.code}`, Object.fromEntries(Object.entries(c.params ?? {}).map(([k, v]) => [k, String(v)]))) : c.code);
}

export function DuplicateBox({ dup, onRecheck, rechecking }: { dup: DuplicateInfo | null; onRecheck?: () => void; rechecking?: boolean }) {
  const t = useTranslations('contentTools.preview');
  const method = (m: string | null | undefined) => (m && t.has(`dupMethod.${m}`) ? t(`dupMethod.${m as 'embedding'}`) : (m ?? '—'));
  return (
    <section className={cn('space-y-2 rounded-lg border p-3', dup?.flagged ? 'border-accent bg-accent/10' : 'border-border')} data-testid="preview-duplicate" data-flagged={dup?.flagged ? 'true' : 'false'}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          {dup?.flagged ? <Copy className="size-4 text-accent-foreground dark:text-accent" aria-hidden /> : null}
          {t('duplicate')}
        </h4>
        {onRecheck ? (
          <Button variant="outline" size="sm" onClick={onRecheck} disabled={rechecking} data-testid="preview-recheck">
            <RefreshCw className={cn(rechecking && 'animate-spin')} aria-hidden />
            {t('recheck')}
          </Button>
        ) : null}
      </div>
      {dup?.flagged ? (
        <p className="text-sm">
          {t('dupOf', { id: (dup.of_question_id ?? '').slice(0, 8), pct: pctOf(dup.similarity), method: method(dup.method) })}
          {dup.of_stem ? <span className="mt-1 block rounded bg-background/70 px-2 py-1 text-xs text-muted-foreground">{dup.of_stem}</span> : null}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('dupNone')}</p>
      )}
      {dup?.similar?.length ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('similar')}</p>
          <ul className="mt-1 space-y-1 text-xs">
            {dup.similar.map((s) => (
              <li key={s.question_id} className="flex gap-2" data-testid="preview-similar">
                <span className="tabular shrink-0 font-semibold">{pctOf(s.similarity)}</span>
                <span className="shrink-0 text-muted-foreground">{method(s.method)}</span>
                <span className="min-w-0 break-words">{s.stem ?? s.question_id.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Khung xem trước câu trong hàng chờ duyệt: nội dung + passage (tab từng văn bản) + AI check + kiểm tra tự động + cờ trùng */
export function QuestionPreview({ item, actions, onRecheck, rechecking }: { item: ReviewQueueItem; actions?: React.ReactNode; onRecheck?: () => void; rechecking?: boolean }) {
  const t = useTranslations('contentTools');
  const tp = useTranslations('contentTools.preview');
  const checkText = useCheckText();
  const c = (item.content ?? {}) as McqContent;
  const correct = Array.isArray(c.answer_key?.correct) ? c.answer_key.correct : c.answer_key?.correct ? [c.answer_key.correct] : [];
  const parts = partsOf(item.passage);
  const issues = (item.ai_check?.issues ?? []) as Array<{ message?: string; detail?: string; severity?: string }>;
  return (
    <article className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="queue-preview" data-question-id={item.id} aria-label={tp('title')}>
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{item.section_code.toUpperCase()}</Badge>
        <Badge variant="outline">{t(`status.${item.workflow_status}`)}</Badge>
        <Badge variant={item.source === 'ai' ? 'gold' : 'muted'}>{t.has(`source.${item.source}`) ? t(`source.${item.source}`) : item.source}</Badge>
        {item.difficulty ? <Badge variant="muted">{item.difficulty}</Badge> : null}
        <span className="text-xs text-muted-foreground">{tp('version', { n: item.version_no })}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          <ShortId id={item.id} /> · <When iso={item.created_at} />
        </span>
      </header>
      {item.passage ? (
        <section className="rounded-lg border border-border bg-background p-3" data-testid="preview-passage">
          <h4 className="mb-2 text-sm font-semibold">{item.passage.title ?? tp('passage')}</h4>
          {parts.length ? (
            <PassageTabs passageId={item.passage.id} parts={parts} idPrefix={`queue-${item.id}-passage`} testId="preview-passage-tabs" />
          ) : (
            <p className="max-h-64 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">{item.passage.body}</p>
          )}
        </section>
      ) : null}
      <section>
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{tp('stem')}</h4>
        <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-wrap" data-testid="preview-stem">
          {c.stem || '—'}
        </p>
      </section>
      {c.options?.length ? (
        <section>
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{tp('options')}</h4>
          <ul className="mt-1 space-y-1">
            {c.options.map((o) => {
              const ok = correct.includes(o.key);
              return (
                <li key={o.key} className={cn('flex gap-2 rounded-md border px-2.5 py-1.5 text-sm', ok ? 'border-success bg-success/10 font-medium' : 'border-border')} data-testid={`preview-option-${o.key}`} data-correct={ok}>
                  <span className="font-bold">{o.key}.</span>
                  <span className="min-w-0 break-words">{o.text}</span>
                  {ok ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {tp('correct')}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {c.explanation && (c.explanation.vi || c.explanation.en) ? (
        <section>
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{tp('explanation')}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{c.explanation.vi ?? c.explanation.en}</p>
        </section>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="space-y-2 rounded-lg border border-border p-3" data-testid="preview-ai-check" data-verdict={item.ai_check?.verdict ?? 'none'}>
          <h4 className="text-sm font-semibold">{tp('aiCheck')}</h4>
          {item.ai_check?.verdict ? (
            <Badge variant={item.ai_check.verdict === 'pass' ? 'success' : item.ai_check.verdict === 'fail' ? 'destructive' : 'gold'}>{t(`verdict.${item.ai_check.verdict}`)}</Badge>
          ) : (
            <p className="text-sm text-muted-foreground">{tp('aiNone')}</p>
          )}
          {issues.length ? (
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {issues.map((i, k) => (
                <li key={k}>{i.message ?? i.detail}</li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="space-y-2 rounded-lg border border-border p-3" data-testid="preview-auto-checks">
          <h4 className="text-sm font-semibold">{tp('autoChecks')}</h4>
          {item.auto_checks.length ? (
            <ul className="space-y-1 text-xs">
              {item.auto_checks.map((ch) => (
                <li key={ch.code} className="flex items-start gap-1.5" data-testid={`auto-check-${ch.code}`} data-level={ch.level}>
                  {ch.level === 'error' ? <XCircle className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden /> : <AlertTriangle className="mt-px size-3.5 shrink-0 text-accent-foreground dark:text-accent" aria-hidden />}
                  <span>
                    <span className="sr-only">{tp(`level.${ch.level}`)}: </span>
                    {checkText(ch)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{tp('autoOk')}</p>
          )}
        </section>
      </div>
      <DuplicateBox dup={item.duplicate} onRecheck={onRecheck} rechecking={rechecking} />
      {actions ? <div className="flex flex-wrap gap-2 border-t border-border pt-3">{actions}</div> : null}
    </article>
  );
}
