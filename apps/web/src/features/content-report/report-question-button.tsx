'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { FileWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@allingo/ui';

const ReportQuestionDialog = dynamic(() => import('./report-question-dialog').then((m) => m.ReportQuestionDialog), { ssr: false });

/**
 * Nút "Báo lỗi câu hỏi" (S12) → `POST /content-reports` theo `question_version_id` (đúng phiên bản người học đã làm – CLAUDE.md
 * §5.9). Nơi gọi chịu trách nhiệm ẩn khi Exam Mode (`hidden`): Review ẩn khi có bài thi exam đang làm; màn làm bài chỉ hiện ở
 * Practice/drill (Exam Mode không có nút).
 */
export function ReportQuestionButton({ questionVersionId, number, hidden = false, className }: { questionVersionId: string; number?: number; hidden?: boolean; className?: string }) {
  const t = useTranslations('contentReport');
  const [open, setOpen] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  if (hidden) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn('text-muted-foreground', className)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={sent ? undefined : number ? t('buttonLabel', { number }) : t('button')}
        data-testid="report-question"
        data-sent={sent || undefined}
      >
        <FileWarning aria-hidden />
        {sent ? t('buttonSent') : t('button')}
      </Button>
      {open ? (
        <ReportQuestionDialog
          questionVersionId={questionVersionId}
          number={number}
          onClose={(ok) => {
            setOpen(false);
            if (ok) setSent(true);
          }}
        />
      ) : null}
    </>
  );
}
