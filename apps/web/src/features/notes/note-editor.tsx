'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Lock, NotebookPen, Pencil, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { NOTE_BODY_MAX, type Note } from '@allingo/schemas';
import { Button, cn, Label, Spinner, Textarea } from '@allingo/ui';
import { Markdown } from '@/components/markdown';
import { handleExamLockedError } from '@/lib/exam-lock';
import { getErrorCode } from '@/lib/errors';
import { createNote, deleteNote, updateNote } from '@/lib/learning-api';
import { createAutosave, type Autosave, type AutosaveStatus } from './autosave';

export const NOTES_KEY = ['notes'] as const;
/** Debounce lưu tự động (ms) */
export const NOTE_AUTOSAVE_MS = 800;

export interface NoteTarget {
  question_version_id?: string;
  attempt_id?: string;
  question_id?: string;
}

/**
 * Ghi chú Markdown ngắn của một câu (Review) hoặc một ghi chú trong "Ghi chú của tôi": gõ → lưu tự động (debounce 0,8 s,
 * nối tiếp: lần đầu POST /notes, sau đó PATCH /notes/{id}); xoá hết chữ hoặc bấm Xoá → DELETE. Tối đa 2.000 ký tự.
 * Exam Mode → chỉ đọc. Hiển thị Markdown đã parse an toàn (không HTML).
 */
export function NoteEditor({
  note: initial,
  target,
  locked = false,
  onChange,
  compact = false,
  testId = 'note',
}: {
  note: Note | null;
  target: NoteTarget;
  locked?: boolean;
  onChange?: (note: Note | null) => void;
  compact?: boolean;
  testId?: string;
}) {
  const t = useTranslations('notes');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [note, setNote] = React.useState<Note | null>(initial);
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(initial?.body ?? '');
  const [status, setStatus] = React.useState<AutosaveStatus>('idle');
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const noteRef = React.useRef<Note | null>(initial);
  const fieldId = React.useId();
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const apply = React.useCallback(
    (n: Note | null) => {
      noteRef.current = n;
      setNote(n);
      onChange?.(n);
      void qc.invalidateQueries({ queryKey: NOTES_KEY });
    },
    [onChange, qc],
  );

  const targetRef = React.useRef(target);
  const applyRef = React.useRef(apply);
  React.useEffect(() => {
    targetRef.current = target;
    applyRef.current = apply;
  }, [apply, target]);

  // Bộ lưu tự động tạo lười trong handler/effect (không đọc ref khi render)
  const saverRef = React.useRef<Autosave<string> | null>(null);
  const initialBody = initial?.body ?? '';
  const getSaver = React.useCallback((): Autosave<string> => {
    saverRef.current ??= createAutosave<string>(
      {
        delay: NOTE_AUTOSAVE_MS,
        save: async (raw) => {
          const body = raw.trim();
          const current = noteRef.current;
          if (!body) {
            if (current) {
              await deleteNote(current.id);
              applyRef.current(null);
            }
            return;
          }
          if (current) applyRef.current(await updateNote(current.id, body));
          else applyRef.current(await createNote({ body, ...targetRef.current }));
        },
        onStatus: (st, err) => {
          setStatus(st);
          if (st === 'error') {
            handleExamLockedError(err);
            setErrorCode(getErrorCode(err));
          } else if (st !== 'dirty') setErrorCode(null);
        },
        equals: (a, b) => a.trim() === b.trim(),
      },
      initialBody,
    );
    return saverRef.current;
  }, [initialBody]);

  // Rời trang/đóng thẻ: lưu ngay phần đang chờ
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void saverRef.current?.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void saverRef.current?.flush();
    };
  }, []);

  // Exam Mode bật khi đang sửa → huỷ phần chưa lưu (server sẽ từ chối)
  const [prevLocked, setPrevLocked] = React.useState(locked);
  if (prevLocked !== locked) {
    setPrevLocked(locked);
    if (locked) setEditing(false);
  }

  const startEdit = () => {
    setText(noteRef.current?.body ?? '');
    setEditing(true);
    window.setTimeout(() => areaRef.current?.focus(), 0);
  };

  const done = async () => {
    const saver = getSaver();
    await saver.flush();
    if (saver.status !== 'error') setEditing(false);
  };

  const remove = async () => {
    const saver = getSaver();
    saver.cancel();
    const current = noteRef.current;
    if (!current) {
      setText('');
      setEditing(false);
      return;
    }
    try {
      setStatus('saving');
      await deleteNote(current.id);
      apply(null);
      saver.reset('');
      setText('');
      setEditing(false);
      toast.success(t('deleted'));
    } catch (err) {
      handleExamLockedError(err);
      setStatus('error');
      setErrorCode(getErrorCode(err));
    }
  };

  const statusLabel =
    status === 'saving' ? (
      <span className="inline-flex items-center gap-1">
        <Spinner className="size-3" aria-hidden />
        {t('saving')}
      </span>
    ) : status === 'saved' ? (
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="size-3" aria-hidden />
        {t('saved')}
      </span>
    ) : status === 'dirty' ? (
      t('unsaved')
    ) : null;

  if (locked) {
    return note ? (
      <div
        className={cn('rounded-lg border border-border bg-muted/40 p-3 text-sm', compact && 'p-2')}
        data-testid={testId}
        data-state="locked"
      >
        <Markdown source={note.body} className="text-sm leading-relaxed" data-testid="note-body" />
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          {t('examLocked')}
        </p>
      </div>
    ) : null;
  }

  if (!editing) {
    return note ? (
      <div
        className="rounded-lg border border-accent/50 bg-accent/5 p-3 text-sm"
        data-testid={testId}
        data-state="view"
        data-note-id={note.id}
      >
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <NotebookPen className="size-3.5" aria-hidden />
          {t('label')}
        </p>
        <Markdown source={note.body} className="leading-relaxed" data-testid="note-body" />
        <div className="mt-2 flex gap-1">
          <Button variant="ghost" size="sm" onClick={startEdit} data-testid="note-edit">
            <Pencil aria-hidden />
            {t('edit')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void remove()} data-testid="note-delete">
            <Trash2 aria-hidden />
            {t('delete')}
          </Button>
        </div>
      </div>
    ) : (
      <Button variant="outline" size="sm" onClick={startEdit} data-testid={`${testId}-add`}>
        <NotebookPen aria-hidden />
        {t('add')}
      </Button>
    );
  }

  return (
    <div
      className="space-y-1.5 rounded-lg border border-border bg-background p-3"
      data-testid={testId}
      data-state="edit"
      data-status={status}
      data-note-id={note?.id ?? ''}
    >
      <Label htmlFor={fieldId} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <NotebookPen className="size-3.5" aria-hidden />
        {t('label')}
      </Label>
      <Textarea
        id={fieldId}
        ref={areaRef}
        value={text}
        maxLength={NOTE_BODY_MAX}
        rows={compact ? 3 : 4}
        placeholder={t('placeholder')}
        onChange={(e) => {
          setText(e.target.value);
          getSaver().schedule(e.target.value);
        }}
        onBlur={() => void getSaver().flush()}
        aria-describedby={`${fieldId}-meta`}
        className="text-sm"
        data-testid="note-input"
      />
      <div
        id={`${fieldId}-meta`}
        className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
      >
        <span aria-live="polite" data-testid="note-status">
          {status === 'error' ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              <TriangleAlert className="size-3" aria-hidden />
              {errorCode === 'exam_mode_locked'
                ? t('examLocked')
                : `${t('saveError')} ${te(`codes.${(errorCode ?? 'internal') as 'internal'}`)}`}
            </span>
          ) : (
            statusLabel
          )}
        </span>
        <span
          className={cn(
            'tabular',
            text.length >= NOTE_BODY_MAX && 'font-semibold text-accent-foreground dark:text-accent',
          )}
          data-testid="note-count"
        >
          {t('count', { count: text.length, max: NOTE_BODY_MAX })}
        </span>
      </div>
      {text.length >= NOTE_BODY_MAX ? (
        <p className="text-xs text-muted-foreground">{t('tooLong', { max: NOTE_BODY_MAX })}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button
          variant="navy"
          size="sm"
          onClick={() => void done()}
          disabled={status === 'saving'}
          data-testid="note-done"
        >
          <Check aria-hidden />
          {t('done')}
        </Button>
        {status === 'error' ? (
          <Button variant="outline" size="sm" onClick={() => void getSaver().retry()} data-testid="note-retry">
            <RotateCcw aria-hidden />
            {t('retry')}
          </Button>
        ) : null}
        {note || text ? (
          <Button variant="ghost" size="sm" onClick={() => void remove()} data-testid="note-delete">
            <Trash2 aria-hidden />
            {t('delete')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
