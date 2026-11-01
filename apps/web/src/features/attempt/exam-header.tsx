'use client';

import { Check, CloudOff, LoaderCircle, Send, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@allingo/ui';
import { LogoMark } from '@/components/logo';
import { formatClock, type ClockTone } from './clock';
import type { DraftStatus } from './draft-queue';

export interface ExamHeaderProps {
  title: string;
  sectionLabel: string | null;
  mode: string;
  remaining: number | null;
  tone: ClockTone;
  announcement: number | null;
  saveStatus: DraftStatus;
  pending: number;
  onSubmit: () => void;
  submitting?: boolean;
}

export function ExamHeader({ title, sectionLabel, mode, remaining, tone, announcement, saveStatus, pending, onSubmit, submitting }: ExamHeaderProps) {
  const t = useTranslations('attempt');
  const clock = remaining === null ? null : formatClock(remaining);

  return (
    <header className="sticky top-0 z-40 bg-navy text-navy-foreground shadow-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <LogoMark className="hidden size-7 sm:block" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{title}</p>
            <p className="truncate text-[11px] text-white/70">
              {mode === 'practice' ? t('practiceTitle') : t('examTitle')}
              {sectionLabel ? ` · ${sectionLabel}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <SaveIndicator status={saveStatus} pending={pending} />
          {clock !== null ? (
            <div
              className={cn('tabular rounded-md px-2.5 py-1 text-lg font-bold tracking-wide', tone === 'danger' ? 'bg-destructive text-white' : tone === 'warning' ? 'bg-accent text-accent-foreground' : 'bg-white/10 text-accent')}
              aria-label={t('timerLabel')}
              data-testid="exam-clock"
            >
              <span aria-hidden>{clock}</span>
              <span className="sr-only">
                {t('timerLabel')}: {clock}
              </span>
            </div>
          ) : (
            <Badge variant="gold" className="hidden sm:inline-flex">
              {t('timerNoLimit')}
            </Badge>
          )}
          <Button variant="gold" size="sm" onClick={onSubmit} disabled={submitting} data-testid="submit-button">
            <Send aria-hidden />
            <span className="hidden sm:inline">{t('submit')}</span>
          </Button>
        </div>
      </div>
      {/* Thông báo mốc thời gian cho trình đọc màn hình (không đọc từng giây) */}
      <p className="sr-only" aria-live="polite" role="status">
        {announcement !== null ? `${t('timerLabel')}: ${formatClock(announcement * 60_000)}` : ''}
      </p>
    </header>
  );
}

function SaveIndicator({ status, pending }: { status: DraftStatus; pending: number }) {
  const t = useTranslations('attempt');
  const map: Record<DraftStatus, { icon: React.ReactNode; label: string; tone: string }> = {
    idle: { icon: null, label: pending > 0 ? t('saving') : '', tone: 'text-white/60' },
    saving: { icon: <LoaderCircle className="size-3.5 animate-spin" aria-hidden />, label: t('saving'), tone: 'text-white/80' },
    saved: { icon: <Check className="size-3.5" aria-hidden />, label: t('saved'), tone: 'text-white/80' },
    error: { icon: <TriangleAlert className="size-3.5" aria-hidden />, label: t('saveFailed'), tone: 'text-accent' },
    offline: { icon: <CloudOff className="size-3.5" aria-hidden />, label: t('reconnecting'), tone: 'text-accent' },
  };
  const cur = map[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', cur.tone)} aria-live="polite" role="status" data-testid="save-status" data-status={status}>
      {cur.icon}
      <span className="hidden sm:inline">{cur.label}</span>
    </span>
  );
}
