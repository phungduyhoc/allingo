'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Layers, PartyPopper, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@allingo/api-client';
import { Alert, AlertDescription, AlertTitle, Button, buttonVariants, Card, CardContent, cn, Progress, Spinner, ToggleChip } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { getSrsDue, postSrsReview } from '@/lib/s10-api';
import { parseQuotaExceeded, resetParts } from '@/lib/quota';
import { useExamLock } from '@/lib/exam-lock';
import { usePatchTask } from '@/features/plan/queries';
import { UPGRADE_HREF } from '@/features/quota/quota-ui';
import { cardView } from './card-view';
import { FlashcardFace } from './flashcard-face';
import { useInvalidateVocab, useSrsCounts } from './queries';
import { speak } from './speak';
import {
  currentCard,
  initialSession,
  intervalOf,
  keyToAction,
  SESSION_SIZES,
  sessionProgress,
  sessionReducer,
  sessionStatus,
  sessionSummary,
  suggestedRating,
  type DictationResult,
  type PendingReview,
  type Rating,
  type ReviewMode,
} from './session';
import { useProgram, useProgramHref } from '@/features/program/program-context';

const RATINGS: Rating[] = [1, 2, 3, 4];
const RATING_KEY = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' } as const;

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * Phiên ôn `/toeic/vocab/review?list=&task=&size=&mode=` (S10): chọn số thẻ 10/20/30 + chế độ (lật thẻ | nghe – gõ lại) →
 * `GET /me/srs/due` → lật/chấm 4 nút (phím Space, 1–4, S phát âm) có lịch dự kiến từ `preview` → `POST /me/srs/review` mỗi lượt
 * (idempotent theo reviewed_at) → Again quay lại trong phiên → tổng kết. Hết hạn mức thẻ mới (429) → thông báo + giờ reset (giờ VN).
 * Mở từ task `vocab_review` (`?task=`): bắt đầu ngay, xong phiên → PATCH task done (server cũng tự xong khi hết thẻ đến hạn).
 */
export function ReviewSessionPage() {
  const program = useProgram();
  const href = useProgramHref();
  const t = useTranslations('flashcards');
  const locale = useLocale();
  const search = useSearchParams();
  const listId = search.get('list');
  const taskId = search.get('task');
  const initialSize = Number(search.get('size')) || 20;
  const [size, setSize] = React.useState<number>(SESSION_SIZES.includes(initialSize as never) ? initialSize : 20);
  const [mode, setMode] = React.useState<ReviewMode>(search.get('mode') === 'dictation' ? 'dictation' : 'flashcard');
  const counts = useSrsCounts(program, listId);
  const [state, dispatch] = React.useReducer(sessionReducer, undefined, initialSession);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<unknown>(null);
  const [emptyInfo, setEmptyInfo] = React.useState<{ next: string | null; resets: string | null; limitHit: boolean } | null>(null);
  const [speaking, setSpeaking] = React.useState(false);
  const [dict, setDict] = React.useState<{ key: string; typed: string; result: DictationResult | null }>({ key: '', typed: '', result: null });
  const invalidate = useInvalidateVocab();
  const patchTask = usePatchTask(program);
  const qc = useQueryClient();
  const examLock = useExamLock();
  const status = sessionStatus(state);
  const card = currentCard(state);

  const start = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setEmptyInfo(null);
    try {
      const due = await getSrsDue({ program, list_id: listId, limit: size });
      if (!due.data.length) setEmptyInfo({ next: due.next_due_at, resets: due.new_resets_at, limitHit: due.counts.new_remaining === 0 && due.counts.new_total > 0 });
      else dispatch({ type: 'start', cards: due.data });
    } catch (e) {
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  }, [listId, program, size]);

  // Mở từ task lộ trình → bắt đầu ngay (một lần)
  const autostarted = React.useRef(false);
  React.useEffect(() => {
    if (taskId && !autostarted.current && !examLock.locked) {
      autostarted.current = true;
      void start();
    }
  }, [examLock.locked, start, taskId]);

  // Gửi lượt chấm: mỗi lượt một POST (lỗi riêng từng lượt), khoá theo card × reviewed_at để không gửi trùng
  const sent = React.useRef(new Set<string>());
  React.useEffect(() => {
    for (const r of state.inflight) {
      const key = `${r.card_id}|${r.reviewed_at}`;
      if (sent.current.has(key)) continue;
      sent.current.add(key);
      void submit(r);
    }
    async function submit(r: PendingReview) {
      try {
        const out = await postSrsReview([{ card_id: r.card_id, rating: r.rating, review_mode: r.review_mode, reviewed_at: r.reviewed_at }]);
        dispatch({ type: 'server_ok', review: r, card: out.find((c) => c.id === r.card_id) ?? null });
      } catch (e) {
        const quota = parseQuotaExceeded(e);
        if (quota && (quota.feature === 'srs_new_cards' || quota.feature === 'unknown')) {
          dispatch({ type: 'server_quota', review: r, resetAt: quota.resetAt });
          toast.warning(t('newLimitTitle'), { id: 'srs-new-limit' });
        } else if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408) {
          // Lỗi nghiệp vụ (thẻ đã xoá/không thuộc người học…) → bỏ lượt, không thử lại
          dispatch({ type: 'server_ok', review: r, card: null });
        } else {
          sent.current.delete(`${r.card_id}|${r.reviewed_at}`);
          dispatch({ type: 'server_error', review: r });
        }
      }
    }
  }, [state.inflight, t]);

  // Thẻ quay lại (Again) mất `preview` → tải lại lịch từ server khi tới lượt (thẻ đã đến hạn mới có trong /me/srs/due)
  const previewAsked = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!card || card.preview || card.state === 'new' || previewAsked.current.has(`${card.id}|${card.due_at}`)) return;
    previewAsked.current.add(`${card.id}|${card.due_at}`);
    void getSrsDue({ program, list_id: listId, limit: 100 })
      .then((due) => dispatch({ type: 'previews', previews: Object.fromEntries(due.data.filter((c) => c.preview && state.cards[c.id]).map((c) => [c.id, c.preview!])) }))
      .catch(() => undefined);
  }, [card, listId, program, state.cards]);

  // Ô gõ (dictation) gắn với lượt hiển thị thẻ: thẻ mới / thẻ Again quay lại → ô trống
  const dictKey = `${card?.id ?? ''}|${state.reviewed}`;
  const dictation = dict.key === dictKey ? dict : { typed: '', result: null };
  const setDictation = React.useCallback((v: { typed: string; result: DictationResult | null }) => setDict({ key: dictKey, ...v }), [dictKey]);

  const doSpeak = React.useCallback(async () => {
    if (!card || card.card_type !== 'vocab') return;
    const v = cardView(card, locale);
    if (v.kind !== 'vocab') return;
    setSpeaking(true);
    await speak(v.tts);
    setSpeaking(false);
  }, [card, locale]);

  // Dictation: phát âm ngay khi thẻ hiện (đã có cử chỉ người dùng ở nút Bắt đầu) – một lần mỗi lượt hiển thị
  const autoSpoken = React.useRef('');
  React.useEffect(() => {
    if (mode !== 'dictation' || !card || card.card_type !== 'vocab' || state.side !== 'front' || autoSpoken.current === dictKey) return;
    autoSpoken.current = dictKey;
    const v = cardView(card, locale);
    if (v.kind === 'vocab') void speak(v.tts);
  }, [card, dictKey, locale, mode, state.side]);

  const rate = React.useCallback((rating: Rating) => dispatch({ type: 'rate', rating, at: new Date().toISOString(), mode: card?.card_type === 'vocab' ? mode : 'flashcard' }), [card?.card_type, mode]);

  React.useEffect(() => {
    if (status !== 'active') return;
    const onKey = (e: KeyboardEvent) => {
      const a = keyToAction(e, state.side, isTyping(e.target));
      if (!a) return;
      // Space/Enter trên nút đang focus: để nút tự xử lý (tránh lật + bấm cùng lúc)
      if ((e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      if (a.type === 'flip') dispatch({ type: 'flip' });
      else if (a.type === 'rate') rate(a.rating);
      else void doSpeak();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSpeak, rate, state.side, status]);

  // Kết thúc phiên: làm mới dữ liệu + đánh dấu task (không đổi nếu server đã tự xong)
  const finished = React.useRef(false);
  React.useEffect(() => {
    if (status !== 'done' || finished.current) return;
    finished.current = true;
    invalidate(program);
    void qc.invalidateQueries({ queryKey: ['me', 'srs'] });
    if (taskId && state.reviewed > 0) patchTask.mutate({ taskId, patch: { status: 'done' } });
  }, [invalidate, patchTask, program, qc, state.reviewed, status, taskId]);

  const restart = () => {
    finished.current = false;
    sent.current.clear();
    previewAsked.current.clear();
    void start();
  };

  const backHref = listId ? href(`vocab/${listId}`) : href('vocab');

  if (examLock.locked) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title={t('title')} />
        <Alert variant="gold">
          <AlertDescription>{t('examLocked')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // ------------------------------------------------------------------ chọn phiên
  if (status === 'idle') {
    const c = counts.data?.counts;
    return (
      <div className="mx-auto max-w-2xl space-y-6" data-testid="review-setup">
        <PageHeader
          title={t('title')}
          description={t('setupDesc')}
          actions={
            <Link href={backHref} className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden />
              {t('backToLists')}
            </Link>
          }
        />
        {counts.isPending ? (
          <CardSkeleton lines={3} />
        ) : counts.isError ? (
          <ErrorState error={counts.error} onRetry={() => void counts.refetch()} />
        ) : (
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label={t('countDue')} value={c?.due_now ?? 0} testId="count-due" />
              <Stat label={t('countNew')} value={c?.new_remaining ?? 0} hint={c?.new_limit != null ? t('countNewOf', { limit: c.new_limit }) : t('unlimited')} testId="count-new" />
              <Stat label={t('countLater')} value={Math.max(0, (c?.due ?? 0) - (c?.due_now ?? 0))} testId="count-later" />
            </CardContent>
          </Card>
        )}
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('sizeLabel')}</legend>
            <div role="group" className="flex flex-wrap gap-2">
              {SESSION_SIZES.map((n) => (
                <ToggleChip key={n} pressed={size === n} onPressedChange={() => setSize(n)} data-testid={`size-${n}`}>
                  {t('sizeOption', { count: n })}
                </ToggleChip>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('modeLabel')}</legend>
            <div role="group" className="flex flex-wrap gap-2">
              {(['flashcard', 'dictation'] as const).map((m) => (
                <ToggleChip key={m} pressed={mode === m} onPressedChange={() => setMode(m)} data-testid={`mode-${m}`}>
                  {t(`mode.${m}`)}
                </ToggleChip>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t(`modeHint.${mode}`)}</p>
          </fieldset>
        </div>
        {loadError ? <ErrorState error={loadError} onRetry={() => void start()} /> : null}
        {emptyInfo ? <EmptyNotice info={emptyInfo} backHref={backHref} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="gold" size="lg" onClick={() => void start()} disabled={loading} data-testid="review-start">
            {loading ? <Spinner className="size-4" /> : <Layers aria-hidden />}
            {t('start')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('shortcuts')}</p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ tổng kết
  if (status === 'done' || status === 'saving') {
    const s = sessionSummary(state);
    return (
      <div className="mx-auto max-w-2xl space-y-6" data-testid="review-summary" data-status={status}>
        <PageHeader title={t('summaryTitle')} description={t('summaryDesc')} />
        {status === 'saving' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner className="size-4" />
            {t('saving')}
          </p>
        ) : null}
        <Card>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-3">
              <PartyPopper className="size-8 text-accent" aria-hidden />
              <p className="text-lg font-semibold">{t('summaryHeadline', { cards: s.cards })}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label={t('summaryReviews')} value={s.reviews} testId="summary-reviews" />
              <Stat label={t('summaryRecall')} value={s.recall === null ? '—' : `${s.recall}%`} testId="summary-recall" />
              <Stat label={t('summaryAgain')} value={s.again} testId="summary-again" />
              <Stat label={t('summaryNew')} value={s.learnedNew} testId="summary-new" />
            </div>
            <ul className="flex flex-wrap gap-2 text-xs">
              {RATINGS.map((r) => (
                <li key={r} className="rounded-full border border-border px-2.5 py-1">
                  {t(`rating.${RATING_KEY[r]}`)}: <span className="tabular font-semibold">{s.ratings[r]}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        {state.newLimit.reached ? <NewLimitNotice resetAt={state.newLimit.resetAt} /> : null}
        <FailedNotice failed={state.failed} onRetry={() => dispatch({ type: 'retry', reviews: state.failed })} />
        <NextDue listId={listId} />
        <div className="flex flex-wrap gap-3">
          <Button variant="gold" onClick={restart} data-testid="review-again-session">
            <RotateCcw aria-hidden />
            {t('continue')}
          </Button>
          <Link href={backHref} className={buttonVariants({ variant: 'outline' })}>
            {t('backToLists')}
          </Link>
          {taskId ? (
            <Link href={href('today')} className={buttonVariants({ variant: 'navy' })} data-testid="review-back-today">
              {t('backToday')}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ đang ôn
  const progress = sessionProgress(state);
  const pct = progress.total ? (progress.done / progress.total) * 100 : 0;
  const suggested = dictation.result ? suggestedRating(dictation.result) : null;
  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="review-session">
      <div className="flex items-center justify-between gap-3">
        <Link href={backHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <ArrowLeft aria-hidden />
          {t('end')}
        </Link>
        <span className="tabular text-sm text-muted-foreground" data-testid="review-progress" data-done={progress.done} data-total={progress.total}>
          {t('progress', { done: progress.done, total: progress.total })}
        </span>
      </div>
      <Progress value={pct} label={t('progressLabel')} />
      {state.newLimit.reached ? <NewLimitNotice resetAt={state.newLimit.resetAt} /> : null}
      <FailedNotice failed={state.failed} onRetry={() => dispatch({ type: 'retry', reviews: state.failed })} />
      {card ? (
        <FlashcardFace
          card={card}
          side={state.side}
          mode={card.card_type === 'vocab' ? mode : 'flashcard'}
          onFlip={() => dispatch({ type: 'flip' })}
          onSpeak={() => void doSpeak()}
          speaking={speaking}
          dictation={dictation}
          onDictation={setDictation}
        />
      ) : null}
      <h2 className="sr-only">{t('rateTitle')}</h2>
      {state.side === 'front' ? (
        mode === 'dictation' && card?.card_type === 'vocab' ? null : (
          <Button variant="navy" size="lg" className="w-full" onClick={() => dispatch({ type: 'flip' })} data-testid="flip">
            {t('flip')}
          </Button>
        )
      ) : (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('rateTitle')}>
          {RATINGS.map((r) => {
            const iv = intervalOf(card?.preview?.[RATING_KEY[r]]);
            return (
              <Button
                key={r}
                variant={r === 1 ? 'destructive' : r === 3 ? 'gold' : 'outline'}
                className={cn('h-auto flex-col gap-0.5 py-2.5', suggested === r && 'ring-[3px] ring-ring/50')}
                onClick={() => rate(r)}
                data-testid={`rate-${r}`}
                aria-keyshortcuts={String(r)}
              >
                <span>{t(`rating.${RATING_KEY[r]}`)}</span>
                <span className="text-[11px] font-normal opacity-80" data-testid={`rate-interval-${r}`}>
                  {iv ? t(`interval.${iv.unit}`, { count: iv.value }) : `${r}`}
                </span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, testId }: { label: string; value: React.ReactNode; hint?: string; testId?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular text-2xl font-extrabold tracking-tight" data-testid={testId}>
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function NewLimitNotice({ resetAt }: { resetAt: string | null }) {
  const t = useTranslations('flashcards');
  const tq = useTranslations('quota');
  const locale = useLocale();
  const parts = resetParts(resetAt, locale);
  return (
    <Alert variant="gold" data-testid="new-limit-notice">
      <CalendarClock aria-hidden />
      <AlertTitle>{t('newLimitTitle')}</AlertTitle>
      <AlertDescription>
        <p>{parts ? tq('resetAt', { ...parts }) : t('newLimitHint')}</p>
        <Link href={UPGRADE_HREF} className="font-semibold underline underline-offset-4">
          {t('newLimitUpgrade')}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

function FailedNotice({ failed, onRetry }: { failed: PendingReview[]; onRetry: () => void }) {
  const t = useTranslations('flashcards');
  if (!failed.length) return null;
  return (
    <Alert variant="destructive" data-testid="review-failed">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{t('failed', { count: failed.length })}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function EmptyNotice({ info, backHref }: { info: { next: string | null; resets: string | null; limitHit: boolean }; backHref: string }) {
  const t = useTranslations('flashcards');
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : null);
  return (
    <div className="space-y-3" data-testid="review-empty">
      <Alert variant="info">
        <AlertTitle>{t('emptyTitle')}</AlertTitle>
        <AlertDescription>
          {info.next ? t('emptyNext', { at: fmt(info.next) ?? '' }) : t('emptyDesc')}{' '}
          <Link href={backHref} className="font-semibold underline underline-offset-4">
            {t('emptyCta')}
          </Link>
        </AlertDescription>
      </Alert>
      {info.limitHit ? <NewLimitNotice resetAt={info.resets} /> : null}
    </div>
  );
}

function NextDue({ listId }: { listId: string | null }) {
  const t = useTranslations('flashcards');
  const counts = useSrsCounts(useProgram(), listId, { staleTime: 0 });
  const c = counts.data;
  if (!c) return null;
  const fresh = Math.min(c.counts.new_remaining ?? c.counts.new_total, c.counts.new_total);
  const fmt = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return (
    <p className="text-sm text-muted-foreground" data-testid="next-due">
      {c.counts.due_now > 0 || fresh > 0 ? t('moreAvailable', { due: c.counts.due_now, fresh }) : c.next_due_at ? t('nextDue', { at: fmt(c.next_due_at) }) : t('allDone')}
    </p>
  );
}
