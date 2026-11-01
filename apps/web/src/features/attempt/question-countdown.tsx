'use client';

import * as React from 'react';
import { Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@allingo/ui';
import type { QuestionTimer } from './question-timer';

/** Đồng hồ từng câu của timed_drill (tự cập nhật 4 lần/giây, không render lại cả màn làm bài) */
export function QuestionCountdown({ timer }: { timer: QuestionTimer }) {
  const t = useTranslations('attempt');
  const { remainingMs } = timer;
  const [left, setLeft] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setLeft(remainingMs());
    const id = window.setInterval(tick, 250);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, [remainingMs]);
  if (left === null || !Number.isFinite(left)) return null;
  const sec = Math.ceil(left / 1000);
  return (
    <Badge variant={sec <= 0 ? 'destructive' : sec <= 5 ? 'gold' : 'secondary'} className="tabular" data-testid="question-timer" data-left={sec} aria-label={t('questionTimerLabel', { seconds: sec })}>
      <Timer aria-hidden />
      {sec <= 0 ? t('questionTimeUp') : t('questionTimerLeft', { seconds: sec })}
    </Badge>
  );
}
