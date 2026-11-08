'use client';

import * as React from 'react';
import {
  BookOpen,
  BookText,
  CalendarCheck,
  ClipboardCheck,
  Dumbbell,
  Ellipsis,
  GripVertical,
  Headphones,
  Layers,
  type LucideIcon,
  MessageCircle,
  Mic,
  PenLine,
  Play,
  RotateCcw,
  Timer,
  Zap,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PlanTask } from '@allingo/schemas';
import { Badge, Button, cn, NativeSelect, Spinner } from '@allingo/ui';
import { useLocalized } from '@/lib/localized';
import { isSelfReported } from './launch';
import { formatDay } from './progress';

/** Icon theo loại task (learn.plan_task_type) */
export const TASK_ICONS: Record<PlanTask['task_type'], LucideIcon> = {
  full_test: ClipboardCheck,
  part_drill: Dumbbell,
  timed_drill: Timer,
  lesson: BookOpen,
  grammar: BookText,
  vocab_review: Layers,
  shadowing: Mic,
  dictation: Headphones,
  writing: PenLine,
  speaking: MessageCircle,
  impromptu: Zap,
  checkin: CalendarCheck,
  review_errors: RotateCcw,
};

export function TaskIcon({ type, className }: { type: PlanTask['task_type']; className?: string }) {
  const Icon = TASK_ICONS[type] ?? Dumbbell;
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground', type === 'full_test' && 'bg-accent text-accent-foreground', className)} aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}

/** "Part 5" từ mã section (tham số evidence) */
export function sectionShort(code: unknown): string {
  const s = typeof code === 'string' ? code : typeof code === 'number' ? String(code) : '';
  const m = /^part(\d+)$/.exec(s);
  return m ? `Part ${m[1]}` : s;
}

/** Lý do giao bài: web dịch `plan.evidence.<code>` (đủ tham số) → dự phòng chuỗi server đã dịch */
export function useEvidenceText(): (task: Pick<PlanTask, 'evidence' | 'evidence_code' | 'evidence_params'>) => string | null {
  const t = useTranslations('plan.evidence');
  return React.useCallback(
    (task) => {
      const code = task.evidence_code;
      if (code && t.has(code)) {
        const p = task.evidence_params ?? {};
        const values: Record<string, string | number> = {
          section: sectionShort(p.section),
          mastery_pct: typeof p.mastery_pct === 'number' ? p.mastery_pct : Number(p.mastery_pct ?? 0) || 0,
          every_weeks: typeof p.every_weeks === 'number' ? p.every_weeks : Number(p.every_weeks ?? 0) || 0,
          count: typeof p.count === 'number' ? p.count : Number(p.count ?? 0) || 0,
        };
        try {
          return t(code, values);
        } catch {
          /* thiếu tham số → dự phòng */
        }
      }
      return task.evidence;
    },
    [t],
  );
}

export function TaskStatusBadge({ task }: { task: Pick<PlanTask, 'status' | 'overdue'> }) {
  const t = useTranslations('plan.status');
  if (task.status === 'pending' && task.overdue)
    return (
      <Badge variant="destructive" data-testid="task-overdue">
        {t('overdue')}
      </Badge>
    );
  if (task.status === 'pending') return null;
  return <Badge variant={task.status === 'done' ? 'success' : 'muted'}>{t(task.status)}</Badge>;
}

export interface TaskRowProps {
  task: PlanTask;
  onOpen: (task: PlanTask) => void;
  onStatus: (task: PlanTask, status: 'done' | 'skipped' | 'pending') => void;
  /** Ngày đích hợp lệ cho menu "Chuyển sang ngày…" (rỗng → ẩn) */
  moveTargets?: string[];
  onMove?: (task: PlanTask, date: string) => void;
  /** Kéo thả (desktop) */
  draggable?: boolean;
  onDragStart?: (task: PlanTask, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  busy?: boolean;
  /** Hiện ngày đến hạn (danh sách quá hạn ở Hôm nay) */
  showDate?: boolean;
  /** Ghi đè số phút (gợi ý 15 phút – rút gọn) */
  minutesOverride?: number;
  compact?: boolean;
  className?: string;
}

/** Một task: icon, tên, phút, trạng thái/quá hạn, nút mở nội dung và menu thao tác (xong / bỏ qua / hoàn tác / chuyển ngày) */
export function TaskRow({ task, onOpen, onStatus, moveTargets = [], onMove, draggable, onDragStart, onDragEnd, busy, showDate, minutesOverride, compact, className }: TaskRowProps) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const L = useLocalized();
  const locale = useLocale();
  const evidence = useEvidenceText()(task);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuId = React.useId();
  const pending = task.status === 'pending';
  const selfReported = isSelfReported(task);
  const openLabel = task.task_type === 'checkin' ? t('actions.checkin') : !pending ? t('actions.reopen') : selfReported && !task.launch ? t('actions.markDone') : t('actions.start');
  const minutes = minutesOverride ?? task.est_minutes;

  return (
    <li
      className={cn('group rounded-lg border border-border bg-card', !pending && 'bg-muted/40', draggable && 'cursor-grab active:cursor-grabbing', className)}
      data-testid="plan-task"
      data-task-id={task.id}
      data-task-type={task.task_type}
      data-status={task.status}
      data-overdue={task.overdue ? 'true' : undefined}
      draggable={draggable || undefined}
      onDragStart={draggable ? (e) => onDragStart?.(task, e) : undefined}
      onDragEnd={draggable ? () => onDragEnd?.() : undefined}
    >
      <div className={cn('flex items-start gap-2.5', compact ? 'p-2.5' : 'p-3')}>
        {draggable ? <GripVertical className="mt-2.5 hidden size-4 shrink-0 text-muted-foreground/60 md:block" aria-hidden /> : null}
        <TaskIcon type={task.task_type} className={compact ? 'size-8' : undefined} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm leading-snug font-medium', !pending && 'text-muted-foreground', task.status === 'skipped' && 'line-through')}>{L(task.title)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular" data-testid="task-minutes">
              {tc('minutes', { count: minutes })}
            </span>
            <span aria-hidden>·</span>
            <span>{t(`taskType.${task.task_type}`)}</span>
            {showDate ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatDay(task.due_date, locale)}</span>
              </>
            ) : null}
            {task.task_type === 'vocab_review' && typeof task.srs_due === 'number' && pending ? (
              <>
                <span aria-hidden>·</span>
                <span>{t('srsDue', { count: task.srs_due })}</span>
              </>
            ) : null}
            <TaskStatusBadge task={task} />
          </p>
          {evidence && !compact ? <p className="mt-1 text-xs text-muted-foreground/90">{evidence}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant={pending ? 'navy' : 'ghost'} onClick={() => onOpen(task)} disabled={busy} data-testid="task-open" aria-label={`${openLabel}: ${L(task.title)}`}>
            {busy ? <Spinner className="size-3.5" /> : compact ? <Play className="sm:hidden" aria-hidden /> : null}
            <span className={cn(compact && 'sr-only sm:not-sr-only')}>{openLabel}</span>
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={t('actions.more')} aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen((v) => !v)} data-testid="task-menu">
            <Ellipsis aria-hidden />
          </Button>
        </div>
      </div>
      {menuOpen ? (
        <div id={menuId} className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5" data-testid="task-actions">
          {pending ? (
            <>
              {task.task_type !== 'checkin' ? (
                <Button size="sm" variant="outline" onClick={() => onStatus(task, 'done')} data-testid="task-done">
                  {t('actions.markDone')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => onStatus(task, 'skipped')} data-testid="task-skip">
                {t('actions.skip')}
              </Button>
            </>
          ) : (
            // Xong/bỏ qua/hết hạn → làm lại (API: task hết hạn ở quá khứ được dời về hôm nay)
            <Button size="sm" variant="ghost" onClick={() => onStatus(task, 'pending')} data-testid="task-undo">
              {t('actions.undo')}
            </Button>
          )}
          {pending && moveTargets.length && onMove ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('actions.moveTo')}</span>
              <NativeSelect
                className="h-8 w-auto py-0 text-xs"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    onMove(task, e.target.value);
                    setMenuOpen(false);
                  }
                }}
                data-testid="task-move-select"
              >
                <option value="">{t('actions.chooseDay')}</option>
                {moveTargets.map((d) => (
                  <option key={d} value={d}>
                    {formatDay(d, locale, { weekday: 'long', day: '2-digit', month: '2-digit' })}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
