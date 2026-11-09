'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';
import { useSectionLabel } from './section-label';

export interface PartBarItem {
  code: string;
  answered: number;
  total: number;
}

/**
 * Thanh Part của Exam Mode: mỗi nút nhảy tới câu đầu của Part; hiện tiến độ đã trả lời.
 * Phím tắt [ / ] chuyển Part (xử lý ở attempt-page). Dùng nav + aria-current thay cho tablist vì không có tabpanel riêng.
 */
export function PartBar({ items, activeIndex, onSelect, className }: { items: PartBarItem[]; activeIndex: number; onSelect: (index: number) => void; className?: string }) {
  const t = useTranslations('attempt');
  const label = useSectionLabel();
  return (
    <nav aria-label={t('partNav')} className={cn('min-w-0', className)} data-testid="part-bar">
      <ol className="flex items-center gap-1 overflow-x-auto py-1">
        {items.map((it, i) => {
          const active = i === activeIndex;
          const done = it.total > 0 && it.answered === it.total;
          return (
            <li key={`${it.code}-${i}`} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={active ? 'step' : undefined}
                // S11 (a11y – WCAG 2.5.3): tên truy cập bắt đầu bằng đúng chữ hiển thị ("Part 1 0/6") rồi mới tới tên đầy đủ
                aria-label={t('partTabAria', { short: label(it.code, { short: true }), title: label(it.code).split(' · ').slice(1).join(' · ') || label(it.code), answered: it.answered, total: it.total })}
                data-testid={`part-tab-${it.code}`}
                data-active={active}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                  active ? 'border-navy bg-navy text-navy-foreground dark:border-primary dark:bg-primary dark:text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-muted',
                )}
              >
                {label(it.code, { short: true })}{' '}
                <span className={cn('tabular rounded px-1.5 text-xs font-medium', active ? 'bg-white/15' : done ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground')}>
                  {it.answered}/{it.total}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
