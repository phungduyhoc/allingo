'use client';

import * as React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  History,
  Lock,
  MessageSquarePlus,
  Quote,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { TUTOR_MESSAGE_MAX_CHARS, type Thread } from '@allingo/schemas';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  buttonVariants,
  cn,
  Skeleton,
  Spinner,
  Textarea,
} from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { Markdown } from '@/components/markdown';
import { aiErrorToApiError } from '@/lib/ai-stream';
import { getErrorCode } from '@/lib/errors';
import { useExamLock } from '@/lib/exam-lock';
import { listThreads } from '@/lib/learning-api';
import { useAiFeedback } from '@/lib/queries';
import { useMediaQuery } from '@/lib/use-media-query';
import { CreditsNotice, QuotaExceededNotice, UPGRADE_HREF, useQuota } from '@/features/quota/quota-ui';
import { feedbackStore, readFeedback } from '@/features/review/feedback-memory';
import { lastAssistant, mergeSuggestions, turnsRemaining, type ChatMessage } from './chat-state';
import type { TutorPanelModel } from './tutor-provider';
import { isFreeContext, THREADS_KEY, type useTutorChat, type TutorContext } from './use-tutor-chat';
import { threadLimitOf } from './thread-limit';

/** Cuộn tới câu được trích dẫn trong trang hiện tại (Review gắn `data-qv` cho từng câu) */
function scrollToQuestion(questionVersionId: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-qv="${CSS.escape(questionVersionId)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el.focus({ preventScroll: true });
  el.dataset.flash = 'true';
  window.setTimeout(() => delete el.dataset.flash, 1600);
  return true;
}

/**
 * Panel gia sư AI trượt bên phải (mobile: toàn màn hình), không chặn trang phía sau trên desktop để vẫn đọc được câu
 * hỏi. Trạng thái hội thoại nằm ở TutorProvider (giữ khi đóng/mở lại); panel chỉ hiển thị.
 */
export function TutorPanel({ open, model, onClose }: { open: boolean; model: TutorPanelModel; onClose: () => void }) {
  const t = useTranslations('tutor');
  const router = useRouter();
  const { chat, context, threadMeta, view, setView, newThread, pickThread } = model;
  const { state } = chat;
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const lock = useExamLock();
  const titleId = React.useId();
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const panelRef = React.useRef<HTMLElement | null>(null);

  // Focus ô nhập khi mở; Esc đóng
  React.useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, open, view]);

  const onCitation = (questionVersionId: string) => {
    if (!isDesktop) onClose();
    window.setTimeout(
      () => {
        if (scrollToQuestion(questionVersionId)) return;
        const attemptId = context?.attemptId ?? threadMeta?.context?.attempt_id;
        if (attemptId) router.push(`/attempts/${attemptId}/review?focus=${encodeURIComponent(questionVersionId)}`);
      },
      isDesktop ? 0 : 120,
    );
  };

  const contextLabel = isFreeContext(context)
    ? t('contextFree')
    : (context?.label ?? (context?.questionVersionId ? t('contextQuestionGeneric') : t('contextAttempt')));

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal={isDesktop ? 'false' : 'true'}
      aria-labelledby={titleId}
      hidden={!open}
      className={cn(
        'fixed inset-0 z-50 flex flex-col bg-card text-card-foreground md:inset-y-0 md:top-16 md:right-0 md:left-auto md:w-[26rem] md:border-l md:border-border md:shadow-2xl',
        'animate-in slide-in-from-right duration-200 motion-reduce:animate-none',
      )}
      data-testid="tutor-panel"
      data-view={view}
      data-thread-id={state.threadId ?? ''}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {view === 'threads' ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setView('chat')}
            aria-label={t('backToChat')}
            data-testid="tutor-back"
          >
            <ArrowLeft aria-hidden />
          </Button>
        ) : (
          <span
            className="inline-flex size-8 items-center justify-center rounded-full bg-navy text-navy-foreground"
            aria-hidden
          >
            <Bot className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-sm leading-tight font-semibold">
            {view === 'threads' ? t('threadsTitle') : (threadMeta?.title ?? t('title'))}
          </h2>
          {view === 'chat' ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate" data-testid="tutor-context">
                {contextLabel}
              </span>
              <TurnsCounter turns={state.turns} />
            </div>
          ) : null}
        </div>
        {view === 'chat' ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setView('threads')}
              aria-label={t('threads')}
              title={t('threads')}
              data-testid="tutor-threads-button"
            >
              <History aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={newThread}
              aria-label={t('newThread')}
              title={t('newThread')}
              data-testid="tutor-new-thread"
            >
              <MessageSquarePlus aria-hidden />
            </Button>
          </>
        ) : null}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('close')} data-testid="tutor-close">
          <X aria-hidden />
        </Button>
      </header>

      {view === 'threads' ? (
        <ThreadList activeId={state.threadId} onPick={pickThread} />
      ) : (
        <ChatBody
          chat={chat}
          context={context}
          locked={lock.locked}
          onCitation={onCitation}
          onNewThread={newThread}
          inputRef={inputRef}
        />
      )}
    </section>
  );
}

function TurnsCounter({ turns }: { turns: { used: number; limit: number | null; remaining: number | null } | null }) {
  const t = useTranslations('tutor');
  const daily = useQuota('ai_tutor');
  const remaining = turnsRemaining(turns);
  if (remaining !== null && turns?.limit !== null && turns?.limit !== undefined) {
    return (
      <Badge
        variant={remaining === 0 ? 'gold' : 'muted'}
        className="tabular"
        data-testid="tutor-turns"
        data-scope="thread"
        data-remaining={remaining}
        data-limit={turns.limit}
        title={t('turnsLeft', { remaining })}
      >
        {t('turnsOf', { remaining, limit: turns.limit })}
      </Badge>
    );
  }
  // Thread không giới hạn lượt → hiện hạn mức ngày `ai_tutor` (Free) nếu có
  const q = daily.quota;
  if (q && q.limit !== null && q.remaining !== null) {
    return (
      <Badge
        variant={q.remaining === 0 ? 'gold' : 'muted'}
        className="tabular"
        data-testid="tutor-turns"
        data-scope="day"
        data-remaining={q.remaining}
        data-limit={q.limit}
      >
        {t('dailyLeft', { remaining: q.remaining })}
      </Badge>
    );
  }
  return null;
}

function ThreadList({ activeId, onPick }: { activeId: string | null; onPick: (th: Thread) => void }) {
  const t = useTranslations('tutor');
  const fmt = useFormatter();
  const q = useInfiniteQuery({
    queryKey: THREADS_KEY,
    queryFn: ({ pageParam }) => listThreads(pageParam, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 0,
  });
  const threads = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="flex-1 overflow-y-auto p-3" data-testid="tutor-threads">
      {q.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : q.isError ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{t('threadsLoadError')}</AlertDescription>
        </Alert>
      ) : threads.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('threadsEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {threads.map((th) => {
            const kind =
              th.context?.kind ??
              (th.context?.question_version_id ? 'question' : th.context?.attempt_id ? 'attempt' : 'free');
            return (
              <li key={th.id}>
                <button
                  type="button"
                  onClick={() => onPick(th)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    th.id === activeId ? 'border-primary/50 bg-primary/5' : 'border-border',
                  )}
                  data-testid="tutor-thread-item"
                  data-thread-id={th.id}
                >
                  <span className="line-clamp-2 text-sm font-medium">{th.title ?? t('untitled')}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">
                      {kind === 'question'
                        ? t('contextQuestionGeneric')
                        : kind === 'attempt'
                          ? t('contextAttempt')
                          : t('contextFree')}
                    </Badge>
                    <span>{t('updatedAt', { time: fmt.relativeTime(new Date(th.updated_at)) })}</span>
                    {th.turns ? <span className="tabular">· {t('turnsShort', { used: th.turns.used })}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {q.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
          data-testid="tutor-threads-more"
        >
          {q.isFetchingNextPage ? <Spinner aria-hidden /> : null}
          {t('threadsLoadMore')}
        </Button>
      ) : null}
    </div>
  );
}

type Chat = ReturnType<typeof useTutorChat>;

function ChatBody({
  chat,
  context,
  locked,
  onCitation,
  onNewThread,
  inputRef,
}: {
  chat: Chat;
  context: TutorContext | null;
  locked: boolean;
  onCitation: (qv: string) => void;
  onNewThread: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useTranslations('tutor');
  const te = useTranslations('errors');
  const tq = useTranslations('quota');
  const { state, send, retry, loadOlder } = chat;
  const [draft, setDraft] = React.useState('');
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const stick = React.useRef(true);
  const live = state.status === 'connecting' || state.status === 'streaming';
  const free = isFreeContext(context);
  const error = state.error;
  const threadLimit = threadLimitOf(error, state.turns);
  const tooLong = draft.length > TUTOR_MESSAGE_MAX_CHARS;

  const base = free
    ? [t('suggestFreeGrammar'), t('suggestFreeStrategy'), t('suggestFreePlan')]
    : (context?.suggestions ?? [t('suggestExample'), t('suggestTrap')]);
  const followups = lastAssistant(state)?.suggestedFollowups ?? [];
  const suggestions = mergeSuggestions(base, followups, 4);

  // Bám đáy khi có tin mới/chữ stream (trừ khi người học đang cuộn đọc tin cũ)
  const lastText = state.messages[state.messages.length - 1]?.text.length ?? 0;
  React.useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, lastText]);

  const submit = (text: string) => {
    if (!text.trim() || live || locked || tooLong || threadLimit.reached) return;
    stick.current = true;
    void send(text);
    setDraft('');
  };

  const older = async () => {
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    stick.current = false;
    await loadOlder();
    setLoadingOlder(false);
    // Giữ vị trí đọc sau khi chèn tin cũ lên đầu
    window.requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  };

  return (
    <>
      <div
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        role="log"
        aria-label={t('messagesRegion')}
        aria-live="polite"
        aria-busy={live}
        data-testid="tutor-messages"
        data-status={state.status}
      >
        {state.olderCursor ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void older()}
              disabled={loadingOlder}
              data-testid="tutor-load-older"
            >
              {loadingOlder ? <Spinner aria-hidden /> : null}
              {t('loadOlder')}
            </Button>
          </div>
        ) : null}

        {state.status === 'loading' ? (
          <div className="space-y-3">
            <Skeleton className="ml-auto h-10 w-3/5" />
            <Skeleton className="h-20 w-4/5" />
          </div>
        ) : state.messages.length === 0 && !(state.status === 'error' && !state.lastInput) ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm" data-testid="tutor-empty">
            <p className="mb-1 flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-accent-foreground dark:text-accent" aria-hidden />
              {t('emptyTitle')}
            </p>
            <p className="text-muted-foreground">{free ? t('emptyFree') : t('emptyQuestion')}</p>
          </div>
        ) : null}

        {state.messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            onCitation={onCitation}
            onRetry={retry}
            canRetry={!live && !locked && !!state.lastInput && i === state.messages.length - 1}
          />
        ))}

        {/* Lỗi không gắn với bong bóng trả lời: tải hội thoại, HTTP trước stream (hạn mức / credit / khác), mạng */}
        {state.status === 'error' &&
        error &&
        !threadLimit.reached &&
        error.code !== 'exam_mode_locked' &&
        !state.messages.some((m) => m.role === 'assistant' && m.status === 'error') ? (
          error.code === 'quota_exceeded' ? (
            <QuotaExceededNotice error={aiErrorToApiError(error)} testId="tutor-quota" />
          ) : error.code === 'insufficient_credits' ? (
            <CreditsNotice error={aiErrorToApiError(error)} />
          ) : (
            <Alert variant="destructive" data-testid="tutor-error" data-code={error.code}>
              <TriangleAlert aria-hidden />
              <AlertTitle>{state.lastInput ? t('errorTitle') : t('loadError')}</AlertTitle>
              <AlertDescription>
                {te(`codes.${getErrorCode(aiErrorToApiError(error))}`)}
                {state.lastInput ? (
                  <div className="mt-2">
                    <Button variant="outline" size="sm" onClick={retry} data-testid="tutor-retry">
                      <RotateCcw aria-hidden />
                      {t('retry')}
                    </Button>
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>
          )
        ) : null}

        {threadLimit.reached ? (
          <Alert variant="gold" data-testid="tutor-thread-limit">
            <TriangleAlert aria-hidden />
            <AlertTitle>{t('threadLimitTitle')}</AlertTitle>
            <AlertDescription>
              <p>
                {threadLimit.limit !== null
                  ? t('threadLimitDesc', { limit: threadLimit.limit })
                  : t('threadLimitDescUnknown')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="navy" size="sm" onClick={onNewThread} data-testid="tutor-thread-limit-new">
                  <MessageSquarePlus aria-hidden />
                  {t('newThreadCta')}
                </Button>
                <Link
                  href={UPGRADE_HREF}
                  className={buttonVariants({ variant: 'gold', size: 'sm' })}
                  data-testid="upgrade-cta"
                >
                  {tq('upgradeCta')}
                </Link>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <footer className="border-t border-border bg-card px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {locked ? (
          <p
            className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
            data-testid="tutor-locked"
          >
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('examLocked')}
          </p>
        ) : (
          <>
            {suggestions.length && !threadLimit.reached ? (
              <div
                className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1"
                role="group"
                aria-label={t('suggestionsLabel')}
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    disabled={live}
                    className="shrink-0 rounded-full border border-accent/60 bg-accent/10 px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none hover:bg-accent/25 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
                    data-testid="tutor-suggestion"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(draft);
              }}
              className="flex items-end gap-2"
            >
              <div className="min-w-0 flex-1">
                <label htmlFor="tutor-input" className="sr-only">
                  {t('inputLabel')}
                </label>
                <Textarea
                  id="tutor-input"
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit(draft);
                    }
                  }}
                  rows={2}
                  placeholder={free ? t('placeholderFree') : t('placeholder')}
                  aria-invalid={tooLong || undefined}
                  aria-describedby="tutor-input-hint"
                  disabled={threadLimit.reached}
                  className="max-h-40 min-h-11 resize-none text-sm"
                  data-testid="tutor-input"
                />
              </div>
              <Button
                type="submit"
                variant="navy"
                size="icon"
                disabled={!draft.trim() || live || tooLong || threadLimit.reached}
                aria-label={t('send')}
                data-testid="tutor-send"
              >
                {live ? <Spinner aria-hidden /> : <ArrowUp aria-hidden />}
              </Button>
            </form>
            <p id="tutor-input-hint" className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {tooLong ? (
                  <span className="text-destructive">{t('tooLong', { max: TUTOR_MESSAGE_MAX_CHARS })}</span>
                ) : (
                  t('disclaimer')
                )}
              </span>
              <span
                className={cn('tabular shrink-0', tooLong && 'font-semibold text-destructive')}
                data-testid="tutor-char-count"
              >
                {t('charCount', { count: draft.length, max: TUTOR_MESSAGE_MAX_CHARS })}
              </span>
            </p>
          </>
        )}
      </footer>
    </>
  );
}

function MessageBubble({
  message: m,
  onCitation,
  onRetry,
  canRetry,
}: {
  message: ChatMessage;
  onCitation: (qv: string) => void;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const t = useTranslations('tutor');
  const te = useTranslations('errors');
  if (m.role === 'user') {
    return (
      <div
        className="flex flex-col items-end gap-1"
        data-testid="tutor-message"
        data-role="user"
        data-status={m.status}
      >
        <p className="sr-only">{t('you')}:</p>
        <div
          className={cn(
            'max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap',
            m.status === 'error' ? 'border border-destructive/50 bg-destructive/10' : 'bg-navy text-navy-foreground',
          )}
        >
          {m.text}
        </div>
      </div>
    );
  }
  const streaming = m.status === 'pending' || m.status === 'streaming';
  return (
    <div
      className="flex flex-col items-start gap-1.5"
      data-testid="tutor-message"
      data-role="assistant"
      data-status={m.status}
      data-refused={m.refused}
      data-refusal-code={m.refusalCode ?? ''}
      data-ai-task-id={m.aiTaskId ?? ''}
    >
      <p className="sr-only">{t('assistant')}:</p>
      {m.refused ? (
        <div
          className="max-w-[92%] rounded-2xl rounded-bl-md border border-accent/60 bg-accent/10 px-3 py-2 text-sm"
          data-testid="tutor-refusal"
        >
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
            <ShieldAlert className="size-3.5" aria-hidden />
            {t('refusedTitle')}
          </p>
          <p>
            {m.text.trim()
              ? m.text
              : t.has(`refusal.${m.refusalCode ?? 'unknown'}` as never)
                ? t(`refusal.${m.refusalCode ?? 'unknown'}` as never)
                : t('refusal.unknown')}
          </p>
        </div>
      ) : m.status === 'error' ? (
        <Alert
          variant="destructive"
          className="max-w-[92%]"
          data-testid="tutor-error"
          data-code={m.errorCode ?? 'ai_failed'}
        >
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('errorTitle')}</AlertTitle>
          <AlertDescription>
            {m.text ? <p className="mb-1 line-clamp-3 text-muted-foreground">{m.text}</p> : null}
            <p>
              {m.errorMessage === 'guard_unavailable'
                ? t('guardUnavailable')
                : te(
                    `codes.${(['ai_failed', 'ai_timeout', 'network', 'internal'] as const).find((c) => c === m.errorCode) ?? 'ai_failed'}`,
                  )}
            </p>
            {canRetry ? (
              <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} data-testid="tutor-retry">
                <RotateCcw aria-hidden />
                {t('retry')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2 text-sm leading-relaxed">
          {streaming && !m.text ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground" data-testid="tutor-typing">
              <span className="inline-flex gap-1" aria-hidden>
                <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current" />
              </span>
              {t('connecting')}
            </span>
          ) : streaming ? (
            // Đang stream: văn bản thuần (chưa parse Markdown để tránh nhấp nháy cú pháp dở)
            <p className="whitespace-pre-wrap" data-testid="tutor-stream" data-chars={m.text.length}>
              {m.text}
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground align-middle" aria-hidden />
            </p>
          ) : (
            <Markdown source={m.text} data-testid="tutor-reply" />
          )}
          {!streaming && m.citations.length ? (
            <ul className="mt-2 space-y-1.5">
              {m.citations.map((c, i) => (
                <li
                  key={`${c.question_version_id}-${i}`}
                  className="rounded-lg border-l-4 border-accent bg-accent/10 px-2.5 py-1.5"
                  data-testid="tutor-citation"
                  data-cite-qv={c.question_version_id}
                >
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <Quote className="size-3" aria-hidden />
                    {t('citationTitle')}
                    {c.section_code ? <span className="uppercase">· {c.section_code}</span> : null}
                  </p>
                  <p className="line-clamp-3 text-xs italic">“{c.excerpt}”</p>
                  <button
                    type="button"
                    onClick={() => onCitation(c.question_version_id)}
                    className="mt-0.5 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                    data-testid="tutor-citation-go"
                  >
                    {t('citationGo')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {m.status === 'done' && !m.refused && m.aiTaskId ? <MessageFeedback aiTaskId={m.aiTaskId} /> : null}
    </div>
  );
}

function MessageFeedback({ aiTaskId }: { aiTaskId: string }) {
  const t = useTranslations('tutor');
  const te = useTranslations('errors');
  const store = React.useSyncExternalStore(
    feedbackStore.subscribe,
    feedbackStore.getSnapshot,
    feedbackStore.getServerSnapshot,
  );
  const remembered = readFeedback(store, aiTaskId, null);
  const feedback = useAiFeedback();
  const [thanks, setThanks] = React.useState(false);
  const rate = (rating: 'helpful' | 'not_helpful') => {
    feedback.mutate(
      { ai_task_id: aiTaskId, rating },
      {
        onSuccess: () => {
          feedbackStore.save({ ai_task_id: aiTaskId, rating, at: Date.now() }, null);
          setThanks(true);
        },
      },
    );
  };
  return (
    <div className="flex items-center gap-1 pl-1" role="group" aria-label={t('feedbackLabel')}>
      {(
        [
          ['helpful', ThumbsUp, 'feedbackHelpful'],
          ['not_helpful', ThumbsDown, 'feedbackNotHelpful'],
        ] as const
      ).map(([rating, Icon, label]) => (
        <Button
          key={rating}
          variant="ghost"
          size="icon-sm"
          className={cn('size-7', remembered?.rating === rating && 'bg-secondary text-secondary-foreground')}
          aria-pressed={remembered?.rating === rating}
          aria-label={t(label)}
          title={t(label)}
          disabled={feedback.isPending}
          onClick={() => rate(rating)}
          data-testid={`tutor-feedback-${rating}`}
        >
          <Icon className="size-3.5" aria-hidden />
        </Button>
      ))}
      <span className="text-[11px] text-muted-foreground" aria-live="polite" data-testid="tutor-feedback-status">
        {feedback.isError ? te(`codes.${getErrorCode(feedback.error)}`) : thanks ? t('feedbackThanks') : ''}
      </span>
    </div>
  );
}
