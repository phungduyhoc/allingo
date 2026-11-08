'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { MessageSquarePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@allingo/ui';
import { useExamLock } from '@/lib/exam-lock';

/** Hộp thoại nạp lười khi bấm (form + tải ảnh không vào JS của mọi trang) */
const FeedbackDialog = dynamic(() => import('./feedback-dialog').then((m) => m.FeedbackDialog), { ssr: false });

/**
 * Nút "Góp ý" trong header AppShell (S12). Ẩn trong Exam Mode (có bài thi exam đang làm – CLAUDE.md §5.8; màn làm bài vốn không
 * có AppShell) và khi chưa biết trạng thái bài thi.
 */
export function FeedbackButton() {
  const t = useTranslations('feedback');
  const lock = useExamLock();
  const [open, setOpen] = React.useState(false);
  if (lock.locked || lock.pending) return null;
  return (
    <>
      <Button variant="ghost" size="sm" className="gap-1.5 px-2 sm:px-3" onClick={() => setOpen(true)} aria-haspopup="dialog" title={t('button')} data-testid="feedback-button">
        <MessageSquarePlus aria-hidden />
        <span className="sr-only lg:not-sr-only">{t('button')}</span>
      </Button>
      {open ? <FeedbackDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
