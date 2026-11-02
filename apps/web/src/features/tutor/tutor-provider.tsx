'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import type { Thread } from '@allingo/schemas';
import { listThreads } from '@/lib/learning-api';
import { isFreeContext, THREADS_KEY, useTutorChat, type TutorContext } from './use-tutor-chat';

/**
 * Điểm mở panel gia sư dùng chung trong AppShell (Review, Dashboard…): `openTutor(ctx)` mở panel với ngữ cảnh câu đang
 * xem / bài làm, hoặc hội thoại tự do (`null`). Mở từ một câu → tiếp tục thread gần nhất cùng câu (nếu có), không thì
 * hội thoại mới (thread tạo khi gửi tin đầu). Giao diện panel chỉ tải khi mở lần đầu – không làm nặng Dashboard.
 */

export type TutorView = 'chat' | 'threads';

interface TutorApi {
  openTutor: (context?: TutorContext | null, opts?: { threadId?: string }) => void;
  closeTutor: () => void;
  isOpen: boolean;
}

export interface TutorPanelModel {
  chat: ReturnType<typeof useTutorChat>;
  context: TutorContext | null;
  threadMeta: Thread | null;
  view: TutorView;
  setView: (v: TutorView) => void;
  newThread: () => void;
  pickThread: (th: Thread) => void;
}

const TutorCtx = React.createContext<TutorApi | null>(null);

const TutorPanel = dynamic(() => import('./tutor-panel').then((m) => m.TutorPanel), { ssr: false });

const contextKey = (c: TutorContext | null | undefined) =>
  isFreeContext(c) ? 'free' : `${c!.attemptId ?? ''}|${c!.questionVersionId ?? ''}`;

export function TutorProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const chat = useTutorChat();
  const { open: openThread, startNew } = chat;
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [context, setContext] = React.useState<TutorContext | null>(null);
  const [threadMeta, setThreadMeta] = React.useState<Thread | null>(null);
  const [view, setView] = React.useState<TutorView>('chat');
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const activeKey = React.useRef<string | null>(null);
  const seq = React.useRef(0);
  const statusRef = React.useRef(chat.state.status);
  React.useEffect(() => {
    statusRef.current = chat.state.status;
  }, [chat.state.status]);

  const openTutor = React.useCallback(
    (ctx: TutorContext | null = null, opts?: { threadId?: string }) => {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const mySeq = ++seq.current;
      setMounted(true);
      setOpen(true);
      setView('chat');
      if (opts?.threadId) {
        activeKey.current = null;
        setContext(ctx);
        setThreadMeta(null);
        void openThread(opts.threadId);
        return;
      }
      const key = contextKey(ctx);
      // Cùng ngữ cảnh với hội thoại đang mở → giữ nguyên (đóng/mở lại panel không mất tin)
      if (activeKey.current === key && statusRef.current !== 'error') return;
      activeKey.current = key;
      setContext(ctx);
      setThreadMeta(null);
      startNew(isFreeContext(ctx) ? null : ctx);
      if (isFreeContext(ctx)) return;
      void (async () => {
        try {
          const page = await qc.fetchQuery({
            queryKey: [...THREADS_KEY, 'first'],
            queryFn: () => listThreads(null, 20),
            staleTime: 5_000,
          });
          const match = page.data.find(
            (th) =>
              th.context?.question_version_id === ctx?.questionVersionId &&
              (!ctx?.attemptId || th.context?.attempt_id === ctx.attemptId),
          );
          if (match && seq.current === mySeq) {
            setThreadMeta(match);
            void openThread(match.id);
          }
        } catch {
          /* không tải được danh sách → hội thoại mới */
        }
      })();
    },
    [openThread, qc, startNew],
  );

  const closeTutor = React.useCallback(() => {
    setOpen(false);
    // Trả focus về nút đã mở panel (a11y)
    const el = triggerRef.current;
    if (el && document.contains(el)) window.setTimeout(() => el.focus({ preventScroll: true }), 0);
  }, []);

  const newThread = React.useCallback(() => {
    activeKey.current = contextKey(context);
    seq.current++;
    setThreadMeta(null);
    startNew(isFreeContext(context) ? null : context);
    setView('chat');
  }, [context, startNew]);

  const pickThread = React.useCallback(
    (th: Thread) => {
      activeKey.current = null;
      seq.current++;
      setThreadMeta(th);
      setContext(
        th.context?.question_version_id || th.context?.attempt_id
          ? { attemptId: th.context.attempt_id, questionVersionId: th.context.question_version_id }
          : null,
      );
      void openThread(th.id);
      setView('chat');
    },
    [openThread],
  );

  const api = React.useMemo(() => ({ openTutor, closeTutor, isOpen: open }), [closeTutor, open, openTutor]);
  const model: TutorPanelModel = { chat, context, threadMeta, view, setView, newThread, pickThread };
  return (
    <TutorCtx.Provider value={api}>
      {children}
      {mounted ? <TutorPanel open={open} model={model} onClose={closeTutor} /> : null}
    </TutorCtx.Provider>
  );
}

export function useTutor(): TutorApi {
  const ctx = React.useContext(TutorCtx);
  if (!ctx) throw new Error('useTutor must be used inside <TutorProvider>');
  return ctx;
}

/** Như useTutor nhưng trả null ngoài provider (component dùng chung ở nơi không có panel) */
export function useOptionalTutor(): TutorApi | null {
  return React.useContext(TutorCtx);
}
