'use client';

import * as React from 'react';
import { CheckCircle2, Clock, ExternalLink, Layers, NotebookPen, RotateCcw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { ERROR_KINDS, type ErrorKind, type ErrorLogEntry, type ErrorPatch } from '@allingo/schemas';
import { Badge, Button, buttonVariants, cn, NativeSelect, Spinner, Textarea } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { formatAnswer } from '@/lib/format-answer';

/**
 * Một mục sổ lỗi: loại lỗi (tự động / người học đổi), Part · kỹ năng con, câu (đề rút gọn – câu nghe Part 1/2 không có chữ),
 * đáp án của bạn vs đáp án đúng, số lần lặp, lần sai gần nhất; thao tác: đã hiểu / mở lại, ghi chú (≤ 1.000), đổi lý do,
 * tạo thẻ ôn SRS (idempotent), xem lại câu trong bài, chọn để "Làm lại".
 */
export function ErrorEntryCard({
  entry,
  selected,
  selectable,
  onToggleSelect,
  onPatch,
  busy,
}: {
  entry: ErrorLogEntry;
  selected: boolean;
  selectable: boolean;
  onToggleSelect: (id: string) => void;
  onPatch: (patch: ErrorPatch) => void;
  busy: boolean;
}) {
  const t = useTranslations('errorLog');
  const ts = useTranslations('sections');
  const tr = useTranslations('result.subskills');
  const fmt = useFormatter();
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState(entry.note ?? '');
  const selectId = React.useId();
  const noteId = React.useId();
  const content = (entry.question?.content ?? {}) as { stem?: unknown; options?: Array<{ key?: string; text?: string }> };
  const stem = typeof content.stem === 'string' && content.stem.trim() ? content.stem : null;
  const passage = entry.question?.passage?.body && entry.question.passage.kind !== 'audio_script' ? entry.question.passage.body : null;
  const section = entry.section_code ?? entry.question?.section_code ?? null;
  const yours = formatAnswer(entry.your_answer);
  const correct = formatAnswer(entry.correct_answer);
  const optionText = (key: string) => content.options?.find((o) => o.key === key)?.text?.trim() || null;

  return (
    <article
      className={cn('space-y-3 rounded-xl border bg-card p-4 sm:p-5', entry.resolved ? 'border-success/40' : 'border-border', selected && 'ring-[3px] ring-ring/40')}
      data-testid="error-entry"
      data-entry-id={entry.id}
      data-kind={entry.kind}
      data-resolved={entry.resolved ? 'true' : 'false'}
    >
      <header className="flex flex-wrap items-center gap-2">
        {selectable ? (
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-navy,#0B1F4B)]"
            checked={selected}
            onChange={() => onToggleSelect(entry.id)}
            aria-label={t('select')}
            data-testid="error-select"
          />
        ) : null}
        <Badge variant={entry.resolved ? 'success' : 'gold'} data-testid="error-kind">
          {t(`kind.${entry.kind}`)}
        </Badge>
        {entry.reason_override ? <span className="text-xs text-muted-foreground">{t('autoWas', { kind: t(`kind.${entry.kind_auto}`) })}</span> : null}
        {section ? <Badge variant="outline">{ts.has(section as never) ? ts(section as never) : section}</Badge> : null}
        {entry.subskill ? <span className="text-xs text-muted-foreground">{tr.has(entry.subskill as never) ? tr(entry.subskill as never) : entry.subskill}</span> : null}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          {entry.occurrences > 1 ? (
            <Badge variant="destructive" data-testid="error-occurrences">
              {t('occurrences', { count: entry.occurrences })}
            </Badge>
          ) : null}
          <time dateTime={entry.last_seen_at}>{fmt.dateTime(new Date(entry.last_seen_at), { dateStyle: 'medium' })}</time>
        </span>
      </header>

      {passage ? <p className="line-clamp-3 rounded-lg bg-muted/60 px-3 py-2 text-sm leading-relaxed text-muted-foreground">{passage}</p> : null}
      <p className="leading-relaxed font-medium" data-testid="error-question">
        {stem ?? t('listeningItem', { section: section && ts.has(section as never) ? ts(section as never) : (section ?? '') })}
      </p>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('yourAnswer')}</dt>
          <dd className="font-semibold" data-testid="error-your-answer">
            {yours ? `${yours}${optionText(yours) ? ` · ${optionText(yours)}` : ''}` : t('blank')}
          </dd>
        </div>
        <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('correctAnswer')}</dt>
          <dd className="font-semibold" data-testid="error-correct-answer">
            {correct ? `${correct}${optionText(correct) ? ` · ${optionText(correct)}` : ''}` : '—'}
          </dd>
        </div>
      </dl>
      {entry.time_spent_ms ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden />
          {t('timeSpent', { seconds: Math.round(entry.time_spent_ms / 1000) })}
        </p>
      ) : null}
      {entry.note && !noteOpen ? (
        <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm" data-testid="error-note">
          <span className="font-semibold">{t('note')}: </span>
          {entry.note}
        </p>
      ) : null}

      {noteOpen ? (
        <div className="space-y-2">
          <label htmlFor={noteId} className="text-sm font-medium">
            {t('note')}
          </label>
          <Textarea id={noteId} value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} data-testid="error-note-input" />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="navy"
              onClick={() => {
                onPatch({ note: note.trim() ? note.trim() : null });
                setNoteOpen(false);
              }}
              data-testid="error-note-save"
            >
              {t('noteSave')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNoteOpen(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" variant={entry.resolved ? 'outline' : 'gold'} onClick={() => onPatch({ resolved: !entry.resolved })} disabled={busy} data-testid="error-resolve">
          {busy ? <Spinner className="size-4" /> : entry.resolved ? <RotateCcw aria-hidden /> : <CheckCircle2 aria-hidden />}
          {entry.resolved ? t('reopen') : t('resolve')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNoteOpen((v) => !v)} data-testid="error-note-toggle">
          <NotebookPen aria-hidden />
          {entry.note ? t('noteEdit') : t('noteAdd')}
        </Button>
        {entry.srs_card_id ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success" data-testid="error-card-created">
            <Layers className="size-3.5" aria-hidden />
            {t('cardCreated')}
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onPatch({ create_card: true })} disabled={busy} data-testid="error-create-card">
            <Layers aria-hidden />
            {t('createCard')}
          </Button>
        )}
        <label htmlFor={selectId} className="sr-only">
          {t('changeReason')}
        </label>
        <NativeSelect
          id={selectId}
          className="h-8 w-auto text-xs"
          value={entry.reason_override ?? ''}
          onChange={(e) => onPatch({ reason_override: (e.target.value || null) as ErrorKind | null })}
          title={t('changeReason')}
          data-testid="error-reason"
        >
          <option value="">{t('reasonAuto', { kind: t(`kind.${entry.kind_auto}`) })}</option>
          {ERROR_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </NativeSelect>
        {entry.attempt_id && entry.question_version_id ? (
          <Link href={`/attempts/${entry.attempt_id}/review?focus=${entry.question_version_id}`} className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'ml-auto')}>
            {t('openReview')}
            <ExternalLink aria-hidden />
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
