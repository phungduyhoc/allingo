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
 * B6/S150: trang `/beta` dùng `examAware={false}` (người bị beta gate chặn không gọi được `/me/attempts`, cũng không thể có bài
 * thi đang làm) và `allowScreenshot={false}` khi chưa có quyền beta (`POST /feedback` miễn gate, `/uploads/presign` thì không).
 */
export function FeedbackButton({ examAware = true, allowScreenshot = true, variant = 'ghost' }: { examAware?: boolean; allowScreenshot?: boolean; variant?: 'ghost' | 'outline' }) {
  return examAware ? <ExamAwareFeedbackButton allowScreenshot={allowScreenshot} variant={variant} /> : <FeedbackTrigger allowScreenshot={allowScreenshot} variant={variant} />;
}

function ExamAwareFeedbackButton(props: { allowScreenshot: boolean; variant: 'ghost' | 'outline' }) {
  const lock = useExamLock();
  if (lock.locked || lock.pending) return null;
  return <FeedbackTrigger {...props} />;
}

function FeedbackTrigger({ allowScreenshot, variant }: { allowScreenshot: boolean; variant: 'ghost' | 'outline' }) {
  const t = useTranslations('feedback');
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={variant} size="sm" className="gap-1.5 px-2 sm:px-3" onClick={() => setOpen(true)} aria-haspopup="dialog" title={t('button')} data-testid="feedback-button">
        <MessageSquarePlus aria-hidden />
        <span className={variant === 'ghost' ? 'sr-only lg:not-sr-only' : undefined}>{t('button')}</span>
      </Button>
      {open ? <FeedbackDialog open={open} onOpenChange={setOpen} allowScreenshot={allowScreenshot} /> : null}
    </>
  );
}
