'use client';

import { Bot, MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent } from '@allingo/ui';
import { useExamLock } from '@/lib/exam-lock';
import { ExamLockBanner } from '@/features/exam-lock/exam-lock-banner';
import { useFlag } from '@/features/flags/flags-provider';
import { useTutor } from './tutor-provider';

/** Thẻ "Hỏi gia sư AI" ở Dashboard (hội thoại tự do + mở lại hội thoại cũ). Exam Mode → ẩn nút, hiện banner tiếp tục bài thi. */
export function DashboardTutorCard() {
  const t = useTranslations('tutor');
  const { openTutor } = useTutor();
  const lock = useExamLock();
  // S11: kill-switch ff.ai.tutor tắt → ẩn thẻ
  const enabled = useFlag('ff.ai.tutor');
  if (!enabled) return null;
  return (
    <section aria-labelledby="tutor-card-title">
      <Card
        className="gap-3 border-navy/20 bg-gradient-to-br from-navy to-[#12306e] text-navy-foreground"
        data-testid="dashboard-tutor"
      >
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <span
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
              aria-hidden
            >
              <Bot className="size-5" />
            </span>
            <div>
              <h2 id="tutor-card-title" className="font-semibold">
                {t('dashboardTitle')}
              </h2>
              <p className="mt-0.5 text-sm text-white/80">{t('dashboardDesc')}</p>
            </div>
          </div>
          {lock.locked ? (
            <ExamLockBanner attemptId={lock.attemptId} className="text-foreground" testId="dashboard-exam-lock" />
          ) : (
            // Nút luôn chiếm chỗ (vô hiệu khi đang kiểm tra Exam Mode) – tránh dịch chuyển bố cục (CLS)
            <div className="flex flex-wrap gap-2">
              <Button variant="gold" onClick={() => openTutor(null)} disabled={lock.pending} data-testid="tutor-open">
                <MessagesSquare aria-hidden />
                {t('open')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
