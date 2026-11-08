'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Spinner, Textarea } from '@allingo/ui';

/**
 * Hộp xác nhận cho thao tác phá huỷ/khó đảo ngược của admin (S12): khoá tài khoản, yêu cầu xoá dữ liệu, impersonate, replay DLQ,
 * thu hồi mã mời, gửi mời theo lô, đổi cờ tính năng, tính lại thống kê. `reason` bắt buộc (≥ `minReason` ký tự) khi API cần lý do
 * (audit). `acknowledge` = ô "Tôi hiểu…" phải tích (xoá dữ liệu). Lỗi API hiển thị trong hộp, không đóng hộp.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  reason,
  acknowledge,
  pending = false,
  error,
  onConfirm,
  children,
  testId = 'confirm-dialog',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  reason?: { label: string; min: number; placeholder?: string; optional?: boolean };
  acknowledge?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  children?: React.ReactNode;
  testId?: string;
}) {
  const t = useTranslations('adminOps');
  const id = React.useId();
  const [text, setText] = React.useState('');
  const [ack, setAck] = React.useState(false);
  const reasonOk = !reason || (reason.optional && !text.trim()) || text.trim().length >= reason.min;
  const ok = reasonOk && (!acknowledge || ack) && !pending;
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)} data-testid={testId}>
      <DialogContent>
        <DialogClose aria-label={t('cancel')} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive ? <AlertTriangle className="size-5 text-destructive" aria-hidden /> : null}
            {title}
          </DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onConfirm(text.trim());
          }}
        >
          {children}
          {reason ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-reason`}>{reason.label}</Label>
              <Textarea id={`${id}-reason`} rows={3} value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} placeholder={reason.placeholder} data-testid={`${testId}-reason`} />
              {!reason.optional ? <p className="text-xs text-muted-foreground">{t('reasonMin', { min: reason.min })}</p> : null}
            </div>
          ) : null}
          {acknowledge ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-destructive)]" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid={`${testId}-ack`} />
              {acknowledge}
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive" data-testid={`${testId}-error`}>
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'navy'} disabled={!ok} data-testid={`${testId}-confirm`}>
              {pending ? <Spinner aria-hidden /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
