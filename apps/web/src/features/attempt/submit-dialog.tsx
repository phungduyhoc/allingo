'use client';

import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@allingo/ui';
import { getErrorCode } from '@/lib/errors';

export function SubmitDialog({
  open,
  onOpenChange,
  unanswered,
  onConfirm,
  submitting,
  error,
  forced = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  unanswered: number;
  onConfirm: () => void;
  submitting: boolean;
  error: unknown;
  /** Hết giờ: không cho huỷ, chỉ hiển thị trạng thái nộp */
  forced?: boolean;
}) {
  const t = useTranslations('attempt');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} dismissible={!forced && !submitting}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{forced ? t('timeUpTitle') : t('submitDialogTitle')}</DialogTitle>
          <DialogDescription>{forced ? t('timeUpDesc') : t('submitDialogDesc', { count: unanswered })}</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{te(`codes.${getErrorCode(error)}`)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          {!forced ? (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {tc('cancel')}
            </Button>
          ) : null}
          <Button variant="navy" onClick={onConfirm} disabled={submitting} data-testid="confirm-submit">
            {submitting ? t('submitting') : error ? tc('retry') : t('submitConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
