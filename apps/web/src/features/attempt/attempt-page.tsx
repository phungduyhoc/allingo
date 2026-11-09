'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, CloudOff, LayoutGrid, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  buttonVariants,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
  SplitPane,
} from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { queryKeys, sendAttemptEvent, useAttempt, useSubmitAttempt } from '@/lib/queries';
import { useLocalized } from '@/lib/localized';
import { useMediaQuery } from '@/lib/use-media-query';
import { asPublicContent, type AnswerInput, type Attempt, type QuestionPublic } from '@/lib/types';
import { ErrorState } from '@/components/states';
import { ExamHeader, FocusBar } from './exam-header';
import { ExamToolbar } from './exam-toolbar';
import { PartBar } from './part-bar';
import { PassagePane } from './passage-pane';
import { markersInStem } from './passage-format';
import { QuestionBlock } from './question-block';
import { QuestionGrid } from './question-grid';
import { SubmitDialog } from './submit-dialog';
import { useSectionLabel } from './section-label';
import { useDraftSaver, useOnlineStatus, type DraftSaver } from './use-draft-saver';
import { useExamClock } from './use-exam-clock';
import { FONT_SCALES, SPLIT_MAX, SPLIT_MIN, stepFont, useExamPrefs } from './exam-prefs';
import { useMediaUrls } from './use-media-urls';
import { buildListeningProgram, toServerCursor } from './listening/program';
import { useExamListening } from './listening/use-exam-listening';
import { ListeningBar, ListeningGate } from './listening/listening-bar';
import { AudioGroupHeader } from './listening/audio-group-header';
import { parseTranscript } from '@/features/review/transcript-format';
import type { ListenStatus } from './question-block';
import { timedDrillBudgetSec, useQuestionTimer } from './question-timer';
import { QuestionCountdown } from './question-countdown';
import { useExamLock } from '@/lib/exam-lock';
import { LookupLayer } from '@/features/dictionary/lookup-layer';
import { recordViewed } from '@/features/offline/viewed-store';
import {
  answerOrEmpty,
  attemptReducer,
  countUnanswered,
  groupOf,
  initialAttemptState,
  isAnswered,
  modeTraits,
  questionGroups,
  sectionIndexOf,
  sectionRanges,
  sortQuestions,
} from './attempt-state';

export function AttemptPage({ attemptId }: { attemptId: string }) {
  const t = useTranslations('attempt');
  const query = useAttempt(attemptId, { refetchOnMount: 'always', staleTime: 0 });
  const inProgress = query.data?.status === 'in_progress';
  // Server từ chối lưu (409: quá hạn + 30 s ân hạn, hoặc đã nộp nơi khác) → runner nộp & chuyển sang kết quả
  const [closed, setClosed] = React.useState(false);
  const onClosed = React.useCallback(() => setClosed(true), []);
  const saver = useDraftSaver(attemptId, { enabled: inProgress, onClosed });

  if (query.isPending || (inProgress && !saver.ready)) {
    return (
      <div className="min-h-dvh bg-background" data-testid="attempt-loading">
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
  return <AttemptRunner attempt={query.data} saver={saver} closed={closed} />;
}

function AttemptRunner({ attempt, saver, closed }: { attempt: Attempt; saver: DraftSaver; closed: boolean }) {
  const t = useTranslations('attempt');
  const L = useLocalized();
  const sectionLabel = useSectionLabel();
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const traits = modeTraits(attempt.mode);
  const questions = React.useMemo(() => sortQuestions(attempt.questions), [attempt.questions]);
  const ranges = React.useMemo(() => sectionRanges(questions), [questions]);
  const groups = React.useMemo(() => questionGroups(questions), [questions]);
  const feedback = React.useMemo(() => attempt.feedback ?? {}, [attempt.feedback]);
  const indexOfId = React.useMemo(() => new Map(questions.map((q, i) => [q.question_id, i])), [questions]);
  // S6: tra từ chỉ ở Practice/drill (không bao giờ ở Exam Mode) và khi không có bài thi khác đang làm (đang tải danh sách →
  // vẫn cho tra; nếu thật sự đang thi, API trả 403 và khoá ngay)
  const examLock = useExamLock(attempt.id);
  const lookupEnabled = traits.feedback && !examLock.locked;
  // "Đề đã xem" cho trang offline (chỉ tên đề + đường dẫn, không lưu câu hỏi/đáp án)
  const viewedTitle =
    attempt.test_set && typeof attempt.test_set === 'object' && 'title' in attempt.test_set && attempt.test_set.title
      ? L(attempt.test_set.title as Record<string, string>) || null
      : null;
  React.useEffect(() => {
    recordViewed({
      id: attempt.id,
      kind: 'attempt',
      title: viewedTitle,
      href: `/attempts/${attempt.id}`,
      mode: attempt.mode,
    });
  }, [attempt.id, attempt.mode, viewedTitle]);

  const [state, dispatch] = React.useReducer(attemptReducer, undefined, () =>
    initialAttemptState(attempt, saver.queue.pendingEntries(), saver.queue.pendingUiState()),
  );
  const current = questions[state.currentIndex] ?? questions[0]!;
  const sectionIdx = Math.max(0, sectionIndexOf(ranges, state.currentIndex));
  const group = groupOf(groups, state.currentIndex);
  const passage = current.passage;
  const groupItems =
    passage && group
      ? questions.slice(group.start, group.end + 1).map((q, k) => ({ q, index: group.start + k }))
      : [{ q: current, index: state.currentIndex }];
  const inGroup = groupItems.length > 1;

  const [prefs, setPrefs] = useExamPrefs();
  const zoom = FONT_SCALES[prefs.font];
  const [splitLive, setSplitLive] = React.useState<number | null>(null);
  const [focus, setFocus] = React.useState(false);
  const [passageCollapsed, setPassageCollapsed] = React.useState(false);
  const [gridOpen, setGridOpen] = React.useState(false);
  const [liveMessage, setLiveMessage] = React.useState('');
  const [checking, setChecking] = React.useState<Record<string, true>>({});

  // Thời gian trên câu hiện tại & theo Part (time_spent_ms, section_elapsed_sec); mốc đặt trong effect (không gọi Date.now() khi render)
  const enteredAtRef = React.useRef(0);
  const sectionEnteredAtRef = React.useRef(0);
  const sectionAccRef = React.useRef<Record<string, number>>({});
  React.useEffect(() => {
    const now = Date.now();
    enteredAtRef.current = now;
    sectionEnteredAtRef.current = now;
  }, []);
  const sectionBase = React.useMemo(
    () => Object.fromEntries(attempt.sections.map((s) => [s.section_code, s.elapsed_sec])),
    [attempt.sections],
  );
  const sectionElapsed = React.useCallback(() => {
    const code = current.section_code;
    const live = (Date.now() - sectionEnteredAtRef.current) / 1000;
    const out: Record<string, number> = {};
    for (const c of new Set([...Object.keys(sectionBase), ...Object.keys(sectionAccRef.current), code])) {
      out[c] = Math.floor((sectionBase[c] ?? 0) + (sectionAccRef.current[c] ?? 0) + (c === code ? live : 0));
    }
    return out;
  }, [current.section_code, sectionBase]);

  // ---------------------------------------------------------------- Listening (Sprint 4)
  // URL ký 10′ → gia hạn ngầm (đề L&R 120′); Exam Mode: chuỗi phát một lần toàn bộ Listening theo thứ tự đề
  const media = useMediaUrls(attempt.id, attempt.questions);
  const examLike = traits.examLike;
  const program = React.useMemo(
    () => (examLike ? buildListeningProgram(questions, groups) : null),
    [examLike, groups, questions],
  );
  const navigateRef = React.useRef<(index: number) => void>(() => undefined);
  // Theo audio: đang xem câu/nhóm đang phát → tự chuyển theo; tự chuyển sang câu khác → hiện nút "Về câu đang nghe"
  const followingRef = React.useRef(true);
  const [following, setFollowingState] = React.useState(true);
  const setFollowing = React.useCallback((v: boolean) => {
    followingRef.current = v;
    setFollowingState(v);
  }, []);
  const listening = useExamListening({
    attemptId: attempt.id,
    program,
    audioPlays: attempt.audio_plays,
    resolveUrl: media.resolveLatest,
    refreshUrls: media.refresh,
    urlsVersion: media.resolve,
    // ui_state.listening: bản chưa gửi trong hàng đợi nháp (IndexedDB) mới hơn bản của server
    serverCursor: saver.queue.pendingUiState()?.listening ?? attempt.ui_state?.listening,
    onCursor: (c) => saver.setMeta({ ui_state: { listening: toServerCursor(c) } }),
    onFocus: (index) => {
      if (followingRef.current) navigateRef.current(index);
    },
    onDone: () => {
      const next = program?.nextIndex ?? null;
      const msg = next !== null ? t('listeningDoneReading') : t('listeningDone');
      setLiveMessage(msg);
      toast.info(msg, { id: 'listening-done' });
      setFollowing(true);
      if (next !== null) navigateRef.current(next);
    },
  });
  const { mountAudio } = listening;
  const listeningLive = listening.active && listening.phase !== 'done';
  const answerable = listening.isAnswerable;

  // ---------------------------------------------------------------- Practice/drill: phản hồi tức thì
  const isLocked = React.useCallback(
    (qid: string) => traits.feedback && (!!feedback[qid] || !!checking[qid]),
    [checking, feedback, traits.feedback],
  );
  const refreshFeedback = React.useCallback(
    () => qc.invalidateQueries({ queryKey: queryKeys.attempt(attempt.id), exact: true }),
    [attempt.id, qc],
  );
  const requestFeedback = React.useCallback(
    async (qid: string) => {
      setChecking((prev) => ({ ...prev, [qid]: true }));
      const before = saver.queue.lastSavedAt;
      await saver.flushNow();
      // Đã lưu từ trước (không có gì để gửi) → tự lấy phản hồi; nếu vừa lưu, effect bên dưới sẽ lấy
      const stillPending = saver.queue.pendingEntries().some((e) => e.question_id === qid);
      if (!stillPending && saver.queue.lastSavedAt === before) await refreshFeedback();
    },
    [refreshFeedback, saver],
  );
  const awaitingFeedback = Object.keys(checking)
    .filter((id) => !feedback[id])
    .join(',');
  const lastFeedbackFetchRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    // Lưu thành công (kể cả sau khi có mạng lại) và còn câu chờ phản hồi → GET attempt để lấy `feedback`; mỗi lần lưu chỉ lấy một lần
    if (!traits.feedback || !awaitingFeedback || saver.status !== 'saved' || saver.lastSavedAt === null) return;
    if (lastFeedbackFetchRef.current === saver.lastSavedAt) return;
    lastFeedbackFetchRef.current = saver.lastSavedAt;
    void refreshFeedback();
  }, [awaitingFeedback, refreshFeedback, saver.lastSavedAt, saver.status, traits.feedback]);

  // ---------------------------------------------------------------- Trả lời / đánh dấu / điều hướng
  const setAnswerFor = React.useCallback(
    (q: QuestionPublic, answer: AnswerInput) => {
      if (isLocked(q.question_id) || !answerable(indexOfId.get(q.question_id) ?? -1)) return;
      dispatch({ type: 'answer', questionId: q.question_id, answer });
      saver.enqueue({ question_id: q.question_id, answer, flagged: state.flags[q.question_id] });
      // Practice: trắc nghiệm một đáp án → lưu ngay và hiện đúng/sai (không chờ debounce/10 s)
      if (traits.feedback && q.question_type === 'mcq_single' && isAnswered(answer))
        void requestFeedback(q.question_id);
    },
    [answerable, indexOfId, isLocked, requestFeedback, saver, state.flags, traits.feedback],
  );

  const toggleFlagFor = React.useCallback(
    (q: QuestionPublic) => {
      const flagged = !state.flags[q.question_id];
      dispatch({ type: 'flag', questionId: q.question_id, flagged });
      saver.enqueue({ question_id: q.question_id, answer: answerOrEmpty(q, state.answers), flagged });
    },
    [saver, state.answers, state.flags],
  );

  const goTo = React.useCallback(
    (index: number) => {
      if (index < 0 || index >= questions.length || index === state.currentIndex) return;
      const now = Date.now();
      const delta = now - enteredAtRef.current;
      if (delta >= 500 && (isAnswered(state.answers[current.question_id]) || delta >= 3000)) {
        saver.enqueue({
          question_id: current.question_id,
          answer: answerOrEmpty(current, state.answers),
          time_spent_ms: delta,
        });
      }
      const next = questions[index]!;
      if (next.section_code !== current.section_code) {
        sectionAccRef.current[current.section_code] =
          (sectionAccRef.current[current.section_code] ?? 0) + (now - sectionEnteredAtRef.current) / 1000;
        sectionEnteredAtRef.current = now;
        sendAttemptEvent(attempt.id, {
          type: 'part_switch',
          meta: { from: current.section_code, to: next.section_code, question_id: next.question_id },
        });
      }
      saver.setMeta({
        ui_state: { current_question_id: next.question_id, current_section_code: next.section_code },
        section_elapsed_sec: sectionElapsed(),
      });
      enteredAtRef.current = now;
      dispatch({ type: 'goto', index });
      void saver.flushNow();
      setGridOpen(false);
    },
    [attempt.id, current, questions, saver, sectionElapsed, state.answers, state.currentIndex, setGridOpen],
  );
  React.useEffect(() => {
    navigateRef.current = goTo;
  }, [goTo]);
  // Điều hướng do người học: rời câu/nhóm đang phát → ngừng tự chuyển theo audio (quay lại bằng nút hoặc chọn lại câu đó)
  const { current: listenStep } = listening;
  const userGoTo = React.useCallback(
    (index: number) => {
      if (listeningLive && listenStep) setFollowing(index >= listenStep.groupStart && index <= listenStep.groupEnd);
      goTo(index);
    },
    [goTo, listenStep, listeningLive, setFollowing],
  );
  const jumpToListening = React.useCallback(() => {
    setFollowing(true);
    if (listenStep) goTo(listenStep.questionIndex);
  }, [goTo, listenStep, setFollowing]);
  const goToPart = React.useCallback(
    (i: number) => {
      const r = ranges[i];
      if (r) userGoTo(r.start);
    },
    [ranges, userGoTo],
  );

  // timed_drill: giới hạn giây từng câu (câu Listening do chuỗi phát điều khiển) – hết giờ câu → sang câu kế
  const budgetSec =
    attempt.mode === 'timed_drill' && !program?.unlockStep.has(state.currentIndex)
      ? timedDrillBudgetSec(attempt.started_at, attempt.expires_at, questions.length)
      : null;
  const questionTimer = useQuestionTimer({
    attemptId: attempt.id,
    questionId: current.question_id,
    budgetSec,
    onTimeout: (qid) => {
      const i = indexOfId.get(qid);
      if (i !== undefined && i === state.currentIndex && i < questions.length - 1) goTo(i + 1);
    },
  });

  // Trong nhóm đoạn văn: đưa câu đang xem vào tầm nhìn khi chuyển bằng phím/nút; mobile vào nhóm mới → về đầu đoạn văn
  const groupKey = group?.key ?? null;
  const prevGroupRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const entered = prevGroupRef.current !== groupKey;
    prevGroupRef.current = groupKey;
    if (!inGroup) return;
    if (entered && !isDesktop) {
      document.querySelector('[data-testid="passage"]')?.scrollIntoView({ block: 'start' });
      return;
    }
    document.getElementById(`qblock-${current.question_id}`)?.scrollIntoView({ block: 'nearest' });
  }, [current.question_id, groupKey, inGroup, isDesktop]);

  // ---------------------------------------------------------------- Nộp bài
  const submit = useSubmitAttempt(attempt.id);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [forced, setForced] = React.useState(false);
  const [syncBlocked, setSyncBlocked] = React.useState(false);
  const goToResult = React.useCallback(() => router.replace(`/attempts/${attempt.id}/result`), [attempt.id, router]);
  const doSubmit = React.useCallback(
    async (opts: { force?: boolean } = {}) => {
      setSyncBlocked(false);
      saver.setMeta({ section_elapsed_sec: sectionElapsed() });
      await saver.flushNow();
      // Còn câu chưa lên server (mất mạng/lỗi) → không nộp để khỏi mất đáp án; người học bấm thử lại khi có mạng
      if (!opts.force && saver.queue.pendingCount > 0) {
        setSyncBlocked(true);
        return;
      }
      submit.mutate(undefined, {
        onSuccess: () => {
          void saver.queue.clear();
          goToResult();
        },
      });
    },
    [goToResult, saver, sectionElapsed, submit],
  );

  // Bài đã đóng phía server → nộp (idempotent; có thể job attempt.expire đã nộp) rồi mở kết quả
  const closedHandledRef = React.useRef(false);
  React.useEffect(() => {
    if (!closed || closedHandledRef.current) return;
    closedHandledRef.current = true;
    submit.mutate(undefined, {
      onSettled: () => {
        void saver.queue.clear();
        goToResult();
      },
    });
  }, [closed, goToResult, saver.queue, submit]);

  const clock = useExamClock(attempt.expires_at, attempt.server_time, {
    onExpire: () => {
      // Hết giờ → tự nộp với các câu đã trả lời (server còn nhận nháp trong 30 s ân hạn)
      setForced(true);
      setSubmitOpen(true);
      sendAttemptEvent(attempt.id, { type: 'section_timeout', meta: { section_code: current.section_code } });
      void doSubmit();
    },
    onWarning: (minutes) => {
      const msg = t('timeWarning', { minutes });
      setLiveMessage(msg);
      toast.warning(msg, { id: `time-warning-${minutes}` });
    },
  });

  // ---------------------------------------------------------------- Sự kiện phiên: rời tab / mất focus / quay lại
  React.useEffect(() => {
    let away: 'tab' | 'focus' | null = null;
    let blurTimer: number | null = null;
    const send = (type: 'tab_hidden' | 'focus_lost' | 'resume') => sendAttemptEvent(attempt.id, { type });
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (blurTimer) window.clearTimeout(blurTimer);
        blurTimer = null;
        if (away !== 'tab') send('tab_hidden');
        away = 'tab';
      } else if (away) {
        away = null;
        send('resume');
      }
    };
    // blur xảy ra trước visibilitychange khi chuyển tab → chờ một nhịp để không đếm trùng tab_hidden + focus_lost
    const onBlur = () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        if (document.visibilityState === 'visible' && !document.hasFocus() && !away) {
          away = 'focus';
          send('focus_lost');
        }
      }, 400);
    };
    const onFocus = () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      blurTimer = null;
      if (away === 'focus') {
        away = null;
        send('resume');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [attempt.id]);

  // ---------------------------------------------------------------- Chế độ tập trung & cỡ chữ
  const setFocusMode = React.useCallback(
    (on: boolean) => {
      setFocus(on);
      setLiveMessage(on ? t('focusModeOn') : t('focusModeOff'));
    },
    [t],
  );
  const changeFont = React.useCallback(
    (delta: 1 | -1) => setPrefs({ font: stepFont(prefs.font, delta) }),
    [prefs.font, setPrefs],
  );

  const listeningGate = listening.active && listening.phase === 'gate';

  // Phím tắt: 1–4 / A–D chọn đáp án, ← → chuyển câu, [ ] chuyển Part, F đánh dấu, Z tập trung, + − cỡ chữ, Esc thoát tập trung
  const content = asPublicContent(current.content);
  const currentAnswer = state.answers[current.question_id] ?? null;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      )
        return;
      if (submitOpen || gridOpen || listeningGate || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      const commands: Record<string, () => void> = {
        z: () => setFocusMode(!focus),
        Z: () => setFocusMode(!focus),
        '+': () => changeFont(1),
        '=': () => changeFont(1),
        '-': () => changeFont(-1),
        _: () => changeFont(-1),
        ']': () => goToPart(sectionIdx + 1),
        '[': () => goToPart(sectionIdx - 1),
        ArrowRight: () => userGoTo(state.currentIndex + 1),
        ArrowLeft: () => userGoTo(state.currentIndex - 1),
        f: () => toggleFlagFor(current),
        F: () => toggleFlagFor(current),
      };
      if (key === 'Escape') {
        if (focus) {
          e.preventDefault();
          setFocusMode(false);
        }
        return;
      }
      const command = commands[key];
      if (command) {
        e.preventDefault();
        command();
        return;
      }
      if (
        !content ||
        (content.type !== 'mcq_single' && content.type !== 'mcq_multi') ||
        isLocked(current.question_id) ||
        !answerable(state.currentIndex)
      )
        return;
      const k = key.toUpperCase();
      const idx = /^[1-9]$/.test(k) ? Number(k) - 1 : /^[A-J]$/.test(k) ? k.charCodeAt(0) - 65 : -1;
      const opt = idx >= 0 ? content.options[idx] : undefined;
      if (!opt) return;
      e.preventDefault();
      if (content.type === 'mcq_single') {
        setAnswerFor(current, { type: 'mcq_single', selected: opt.key });
      } else {
        const sel = new Set(currentAnswer?.type === 'mcq_multi' ? currentAnswer.selected : []);
        if (sel.has(opt.key)) sel.delete(opt.key);
        else sel.add(opt.key);
        setAnswerFor(current, {
          type: 'mcq_multi',
          selected: content.options.filter((o) => sel.has(o.key)).map((o) => o.key),
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    answerable,
    changeFont,
    content,
    current,
    currentAnswer,
    focus,
    goToPart,
    gridOpen,
    isLocked,
    listeningGate,
    sectionIdx,
    setAnswerFor,
    setFocusMode,
    state.currentIndex,
    submitOpen,
    toggleFlagFor,
    userGoTo,
  ]);

  // ---------------------------------------------------------------- Dữ liệu hiển thị
  const gridItems = React.useMemo(
    () =>
      questions.map((q, i) => ({
        questionId: q.question_id,
        number: i + 1,
        answered: isAnswered(state.answers[q.question_id]),
        flagged: !!state.flags[q.question_id],
        sectionCode: q.section_code,
      })),
    [questions, state.answers, state.flags],
  );
  const partItems = React.useMemo(
    () =>
      ranges.map((r) => ({
        code: r.code,
        total: r.end - r.start + 1,
        answered: gridItems.slice(r.start, r.end + 1).filter((g) => g.answered).length,
      })),
    [gridItems, ranges],
  );
  const unanswered = countUnanswered(questions, state.answers);
  const title =
    attempt.test_set && typeof attempt.test_set === 'object' && 'title' in attempt.test_set && attempt.test_set.title
      ? L(attempt.test_set.title as Record<string, string>) || t('examTitle')
      : t('examTitle');
  const modeLabel =
    attempt.mode === 'exam'
      ? t('examTitle')
      : attempt.mode === 'timed_drill'
        ? t('timedDrillTitle')
        : attempt.mode === 'diagnostic'
          ? t('diagnosticTitle')
          : attempt.mode === 'drill'
            ? t('drillTitle')
            : t('practiceTitle');
  const bannerMode = closed ? null : !online ? 'offline' : saver.recovering && saver.pending > 0 ? 'syncing' : null;
  const disabled = submit.isPending || clock.expired || closed;
  const isLast = state.currentIndex >= questions.length - 1;

  // Trạng thái nghe (Exam Mode): sắp phát (khoá chọn) / đang phát / đã phát
  const listenStatusOf = (index: number): ListenStatus | null => {
    if (!listening.active || !program?.unlockStep.has(index)) return null;
    if (listening.phase === 'done') return 'played';
    if (!answerable(index)) return 'upcoming';
    const cur = listening.current;
    if (
      cur?.kind === 'audio' &&
      listening.phase !== 'gate' &&
      (cur.role === 'group' ? index >= cur.groupStart && index <= cur.groupEnd : cur.questionIndex === index)
    )
      return 'playing';
    return 'played';
  };

  const blocks = groupItems.map(({ q, index }) => {
    const audioMedia = q.media.find((m) => m.kind === 'audio');
    // Câu "nghe một lần" do chuỗi phát điều khiển; còn lại (Practice/drill, câu listen_policy = free) → trình phát tự do
    const freeAudio =
      audioMedia && !program?.unlockStep.has(index)
        ? {
            src: media.resolve(audioMedia.id, audioMedia.url),
            onError: () => void media.refresh(),
            onStarted: () =>
              sendAttemptEvent(attempt.id, {
                type: 'audio_started',
                meta: { question_id: q.question_id, asset_id: audioMedia.id },
              }),
          }
        : null;
    return (
      <QuestionBlock
        key={q.question_id}
        question={q}
        number={index + 1}
        total={questions.length}
        answer={state.answers[q.question_id] ?? null}
        flagged={!!state.flags[q.question_id]}
        current={index === state.currentIndex}
        inGroup={inGroup}
        onActivate={() => userGoTo(index)}
        onAnswer={(a) => setAnswerFor(q, a)}
        onToggleFlag={() => toggleFlagFor(q)}
        disabled={disabled}
        zoom={zoom}
        badge={
          <>
            {!traits.examLike ? <Badge variant="secondary">{modeLabel}</Badge> : null}
            {index === state.currentIndex && questionTimer.budgetSec !== null ? (
              <QuestionCountdown timer={questionTimer} />
            ) : null}
          </>
        }
        audio={freeAudio}
        imageUrl={media.resolve}
        listen={listenStatusOf(index)}
        practice={
          traits.feedback
            ? {
                feedback: feedback[q.question_id],
                checking: !!checking[q.question_id],
                locked: isLocked(q.question_id),
                online,
                onCheck: () => void requestFeedback(q.question_id),
              }
            : undefined
        }
      />
    );
  });

  const navRow = (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <Button
        variant="outline"
        onClick={() => userGoTo(state.currentIndex - 1)}
        disabled={state.currentIndex === 0}
        data-testid="prev-button"
      >
        <ChevronLeft aria-hidden />
        {t('prev')}
      </Button>
      <p className="hidden text-center text-xs text-muted-foreground md:block">{t('keyboardHintExam')}</p>
      {!isLast ? (
        <Button variant="navy" onClick={() => userGoTo(state.currentIndex + 1)} data-testid="next-button">
          {t('next')}
          <ChevronRight aria-hidden />
        </Button>
      ) : (
        <Button variant="gold" onClick={() => setSubmitOpen(true)} data-testid="next-button">
          {t('submit')}
        </Button>
      )}
    </div>
  );

  const questionsColumn = (
    <div className="space-y-4">
      {traits.feedback && state.currentIndex === 0 ? (
        <Alert variant="info">
          <AlertDescription>{t('practiceFeedbackHint')}</AlertDescription>
        </Alert>
      ) : null}
      {blocks}
      {navRow}
    </div>
  );

  const highlight = markersInStem(content && 'stem' in content ? content.stem : null);
  const rangeLabel = inGroup
    ? t('groupRange', { from: groupItems[0]!.index + 1, to: groupItems[groupItems.length - 1]!.index + 1 })
    : undefined;
  // Part 3/4: passage audio_script không có chữ khi đang làm bài → đầu nhóm (trạng thái nghe / trình phát practice), không chia đôi màn hình
  const audioPassage = passage?.kind === 'audio_script' ? passage : null;
  const textPassage = audioPassage ? null : passage;
  let body: React.ReactNode = questionsColumn;
  if (audioPassage) {
    const groupStart = groupItems[0]!.index;
    const groupStatus = listenStatusOf(groupStart);
    const groupTranscript = traits.feedback
      ? (groupItems
          .map(({ q }) => parseTranscript(feedback[q.question_id]?.transcript))
          .find((x) => x?.source === 'passage') ?? null)
      : null;
    const audioRange = inGroup
      ? t('audioGroupRange', { from: groupStart + 1, to: groupItems[groupItems.length - 1]!.index + 1 })
      : undefined;
    body = (
      <div className="space-y-4">
        <AudioGroupHeader
          key={group?.key}
          passage={audioPassage}
          rangeLabel={audioRange}
          exam={groupStatus ? { status: groupStatus } : null}
          player={
            !groupStatus && audioPassage.media_url
              ? {
                  src: media.resolve(audioPassage.media_asset_id, audioPassage.media_url),
                  onError: () => void media.refresh(),
                  onStarted: () =>
                    sendAttemptEvent(attempt.id, {
                      type: 'audio_started',
                      meta: {
                        question_id: groupItems[0]!.q.question_id,
                        ...(audioPassage.media_asset_id ? { asset_id: audioPassage.media_asset_id } : {}),
                      },
                    }),
                }
              : null
          }
          transcript={groupTranscript}
        />
        {questionsColumn}
      </div>
    );
  } else if (textPassage && isDesktop) {
    body = (
      <SplitPane
        data-testid="split-pane"
        className="h-full"
        ratio={splitLive ?? prefs.split}
        min={SPLIT_MIN}
        max={SPLIT_MAX}
        onRatioChange={setSplitLive}
        onRatioCommit={(r) => {
          setSplitLive(null);
          setPrefs({ split: r });
        }}
        separatorLabel={t('splitterLabel')}
        startClassName="h-full"
        endClassName="h-full overflow-y-auto pb-4 pl-2"
        start={
          // key theo nhóm: đổi nhóm → cuộn đoạn văn về đầu; cùng nhóm → giữ vị trí đang đọc
          // C2/a11y: vùng cuộn đoạn văn dài (IELTS) phải nhận focus bàn phím để cuộn được (axe scrollable-region-focusable)
          <div key={group?.key} className="h-full overflow-y-auto pr-2 pb-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" tabIndex={0} role="region" aria-label={t('passageTitle')}>
            <PassagePane
              passage={textPassage}
              zoom={zoom}
              highlight={highlight}
              rangeLabel={rangeLabel}
              className="min-h-full"
            />
          </div>
        }
        end={questionsColumn}
      />
    );
  } else if (textPassage) {
    body = (
      <div className="space-y-4">
        <PassagePane
          passage={textPassage}
          zoom={zoom}
          highlight={highlight}
          rangeLabel={rangeLabel}
          collapsible
          collapsed={passageCollapsed}
          onToggle={() => setPassageCollapsed((c) => !c)}
        />
        {questionsColumn}
      </div>
    );
  }

  const listenQ = listenStep ? questions[listenStep.questionIndex] : undefined;
  const listeningNowLabel = !listenStep
    ? ''
    : listenStep.kind === 'audio' && listenStep.role === 'group'
      ? t('listeningNowGroup', {
          title: listenQ?.passage?.title ?? t('audioGroupTitle'),
          from: listenStep.groupStart + 1,
          to: listenStep.groupEnd + 1,
        })
      : listenStep.kind === 'pause'
        ? t('listeningNowAnswer', { number: listenStep.questionIndex + 1 })
        : t('listeningNowQuestion', { number: listenStep.questionIndex + 1 });
  const listeningPartLabel = listenQ
    ? `${sectionLabel(listenQ.section_code)} · ${t('listeningQuestionCount', { count: program?.unlockStep.size ?? 0 })}`
    : '';

  // Desktop có đoạn văn: khung cố định theo chiều cao màn hình, hai khung cuộn riêng (header/banner co giãn tự nhiên)
  const splitLayout = !!textPassage && isDesktop;
  return (
    <div
      className={cn(
        'flex flex-col bg-background',
        splitLayout ? 'h-dvh overflow-hidden' : 'min-h-dvh',
        focus && 'pt-2',
      )}
      data-testid="attempt-runner"
      data-focus={focus}
      data-mode={attempt.mode}
      data-store={saver.storeKind}
    >
      {focus ? (
        <FocusBar
          remaining={clock.remaining}
          tone={clock.tone}
          saveStatus={saver.status}
          pending={saver.pending}
          onExit={() => setFocusMode(false)}
        />
      ) : (
        <>
          <ExamHeader
            title={title}
            sectionLabel={sectionLabel(current.section_code)}
            modeLabel={modeLabel}
            remaining={clock.remaining}
            tone={clock.tone}
            saveStatus={saver.status}
            pending={saver.pending}
            onSubmit={() => setSubmitOpen(true)}
            submitting={submit.isPending}
          />
          <ExamToolbar font={prefs.font} onFont={changeFont} onFocus={() => setFocusMode(true)}>
            {ranges.length > 1 ? <PartBar items={partItems} activeIndex={sectionIdx} onSelect={goToPart} /> : null}
          </ExamToolbar>
        </>
      )}

      {/* Dính dưới header (56 px) + thanh công cụ (45 px); chế độ tập trung → sát mép trên */}
      {listeningLive ? (
        <ListeningBar
          listening={listening}
          nowLabel={listeningNowLabel}
          following={following}
          onJump={jumpToListening}
          online={online}
          className={focus ? 'top-0' : 'top-[101px]'}
        />
      ) : null}
      {/* Phần tử <audio> của chuỗi phát (không có điều khiển – không tua/tạm dừng) */}
      <div ref={mountAudio} hidden data-testid="exam-audio-pool" />
      {listeningGate && !closed ? <ListeningGate listening={listening} partLabel={listeningPartLabel} /> : null}

      {/* Thông báo cho trình đọc màn hình: mốc thời gian 10′/5′/1′, bật/tắt tập trung (không đọc từng giây) */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="attempt-live">
        {liveMessage}
      </p>

      {bannerMode ? (
        <div
          className={cn(
            'border-b',
            bannerMode === 'offline' ? 'border-accent/50 bg-accent/15' : 'border-primary/30 bg-primary/10',
          )}
          role="status"
          data-testid="offline-banner"
          data-mode={bannerMode}
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm sm:px-5">
            {bannerMode === 'offline' ? (
              <CloudOff className="size-4 shrink-0" aria-hidden />
            ) : (
              <RefreshCw className="size-4 shrink-0 animate-spin" aria-hidden />
            )}
            <span>{bannerMode === 'offline' ? t('offlineQueued') : t('syncingBanner')}</span>
            {saver.pending > 0 ? (
              <span className="tabular text-xs text-muted-foreground">
                ({t('pendingCount', { count: saver.pending })})
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {closed ? (
        <div className="mx-auto w-full max-w-7xl px-3 pt-4 sm:px-5">
          <Alert variant="destructive" data-testid="attempt-closed">
            <AlertTitle>{t('closedTitle')}</AlertTitle>
            <AlertDescription>{t('closedDesc')}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div
        className={cn(
          'mx-auto grid w-full max-w-7xl flex-1 gap-6 px-3 py-4 pb-28 sm:px-5 lg:pb-6',
          splitLayout ? 'min-h-0 grid-rows-[minmax(0,1fr)]' : 'content-start items-start',
          !focus && 'lg:grid-cols-[minmax(0,1fr)_280px]',
        )}
      >
        <div className={cn('min-w-0', splitLayout && 'h-full min-h-0')}>{body}</div>
        {!focus ? (
          <aside className={cn('hidden lg:block', splitLayout && 'min-h-0')}>
            <div
              className={cn(
                'overflow-y-auto rounded-xl border border-border bg-card p-4',
                splitLayout ? 'max-h-full' : 'sticky top-28 max-h-[calc(100dvh-8rem)]',
              )}
            >
              <QuestionGrid items={gridItems} currentIndex={state.currentIndex} onSelect={userGoTo} />
            </div>
          </aside>
        ) : null}
      </div>

      {/* Thanh điều hướng mobile */}
      {!focus ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => userGoTo(state.currentIndex - 1)}
              disabled={state.currentIndex === 0}
              aria-label={t('prev')}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setGridOpen(true)} aria-label={t('gridOpen')}>
              <LayoutGrid aria-hidden />
              <span className="tabular">
                {t('progress', { answered: questions.length - unanswered, total: questions.length })}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => userGoTo(state.currentIndex + 1)}
              disabled={isLast}
              aria-label={t('next')}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog open={gridOpen} onOpenChange={setGridOpen} side="bottom">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('gridTitle')}</DialogTitle>
          </DialogHeader>
          <QuestionGrid items={gridItems} currentIndex={state.currentIndex} onSelect={userGoTo} />
        </DialogContent>
      </Dialog>

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        unanswered={unanswered}
        onConfirm={() => void doSubmit()}
        submitting={submit.isPending}
        error={submit.error ?? (syncBlocked ? new TypeError('draft not synced') : null)}
        forced={forced}
      />
      {traits.feedback ? (
        <LookupLayer enabled={lookupEnabled} source={{ type: 'passage', attemptId: attempt.id }} />
      ) : null}
    </div>
  );
}
