'use client';

import { AArrowDown, AArrowUp, Maximize2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@allingo/ui';
import type { FontLevel } from './exam-prefs';

const LEVEL_NAMES = ['normal', 'large', 'xlarge'] as const;

/** Thanh công cụ dưới header: (Part bar ở bên trái do nơi dùng truyền vào) · cỡ chữ 3 mức · chế độ tập trung */
export function ExamToolbar({ children, font, onFont, onFocus, className }: { children?: React.ReactNode; font: FontLevel; onFont: (delta: 1 | -1) => void; onFocus: () => void; className?: string }) {
  const t = useTranslations('attempt');
  return (
    <div className={cn('sticky top-14 z-30 border-b border-border bg-background/95 backdrop-blur', className)} data-testid="exam-toolbar">
      <div className="mx-auto flex min-h-11 max-w-7xl items-center gap-3 px-3 sm:px-5">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label={t('fontSize')}>
          <Button variant="ghost" size="icon-sm" onClick={() => onFont(-1)} disabled={font === 0} aria-label={t('fontDecrease')} title={t('fontDecrease')} data-testid="font-decrease">
            <AArrowDown aria-hidden />
          </Button>
          <span className="sr-only" aria-live="polite" data-testid="font-level" data-level={font}>
            {t('fontLevel', { level: LEVEL_NAMES[font] })}
          </span>
          <span className="hidden gap-0.5 sm:flex" aria-hidden>
            {[0, 1, 2].map((l) => (
              <span key={l} className={cn('h-1.5 w-3 rounded-full', l <= font ? 'bg-primary' : 'bg-border')} />
            ))}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => onFont(1)} disabled={font === 2} aria-label={t('fontIncrease')} title={t('fontIncrease')} data-testid="font-increase">
            <AArrowUp aria-hidden />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={onFocus} title={t('focusModeEnter')} data-testid="focus-toggle">
          <Maximize2 aria-hidden />
          <span className="hidden sm:inline">{t('focusMode')}</span>
          <span className="sr-only sm:hidden">{t('focusModeEnter')}</span>
        </Button>
      </div>
    </div>
  );
}
