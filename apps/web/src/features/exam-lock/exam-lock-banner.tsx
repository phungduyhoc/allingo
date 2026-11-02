'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, buttonVariants, cn } from '@allingo/ui';
import { Link } from '@/i18n/navigation';

/** Banner Exam Mode (dùng chung Review/Dashboard/Ghi chú): công cụ trợ giúp tạm khoá + nút "Tiếp tục bài thi" */
export function ExamLockBanner({
  attemptId,
  message,
  className,
  testId = 'exam-lock-banner',
}: {
  attemptId: string | null;
  message?: string;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations('examLock');
  return (
    <Alert variant="info" className={className} data-testid={testId}>
      <Lock aria-hidden />
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>{message ?? t('banner')}</span>
        {attemptId ? (
          <Link
            href={`/attempts/${attemptId}`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            data-testid="continue-exam"
          >
            {t('continueExam')}
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
