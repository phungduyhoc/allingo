'use client';

import { Check, CloudOff, LoaderCircle, Minimize2, Send, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@allingo/ui';
import { LogoMark } from '@/components/logo';
import { formatClock, type ClockTone } from './clock';
import type { DraftStatus } from './draft-queue';

export interface ExamHeaderProps {
  title: string;
  sectionLabel: string | null;
  modeLabel: string;
  remaining: number | null;
  tone: ClockTone;
  saveStatus: DraftStatus;
  pending: number;
  onSubmit: () => void;
  submitting?: boolean;
}

export function ExamHeader({ title, sectionLabel, modeLabel, remaining, tone, saveStatus, pending, onSubmit, submitting }: ExamHeaderProps) {
  const t = useTranslations('attempt');
  return (
    <header className="sticky top-0 z-40 bg-navy text-navy-foreground shadow-md" data-testid="exam-header">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <LogoMark className="hidden size-7 sm:block" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{title}</p>
            <p className="truncate text-[11px] text-white/70">
              {modeLabel}
              {sectionLabel ? ` · ${sectionLabel}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <SaveIndicator status={saveStatus} pending={pending} />
          {remaining !== null ? (
            <ClockBadge remaining={remaining} tone={tone} />
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
    </header>
  );
}

export function ClockBadge({ remaining, tone, className }: { remaining: number; tone: ClockTone; className?: string }) {
  const t = useTranslations('attempt');
  const clock = formatClock(remaining);
  return (
    <div
      className={cn('tabular rounded-md px-2.5 py-1 text-lg font-bold tracking-wide', tone === 'danger' ? 'bg-destructive text-white' : tone === 'warning' ? 'bg-accent text-accent-foreground' : 'bg-white/10 text-accent', className)}
      data-testid="exam-clock"
      data-tone={tone}
    >
      <span aria-hidden>{clock}</span>
      <span className="sr-only">
        {t('timerLabel')}: {clock}
      </span>
    </div>
  );
}

/** Chế độ tập trung: header/lưới ẩn, chỉ còn viên nhỏ góc phải với đồng hồ + trạng thái lưu + nút thoát */
export function FocusBar({ remaining, tone, saveStatus, pending, onExit }: { remaining: number | null; tone: ClockTone; saveStatus: DraftStatus; pending: number; onExit: () => void }) {
  const t = useTranslations('attempt');
  return (
    <div className="fixed top-3 right-3 z-40 flex items-center gap-2 rounded-full bg-navy/95 py-1 pr-1 pl-3 text-navy-foreground shadow-lg backdrop-blur" data-testid="focus-bar">
      <SaveIndicator status={saveStatus} pending={pending} />
      {remaining !== null ? <ClockBadge remaining={remaining} tone={tone} className="py-0.5 text-base" /> : null}
      <Button variant="ghost" size="icon-sm" className="rounded-full text-navy-foreground hover:bg-white/15" onClick={onExit} aria-label={t('focusModeExit')} title={t('focusModeExit')} data-testid="focus-exit">
        <Minimize2 aria-hidden />
      </Button>
    </div>
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
