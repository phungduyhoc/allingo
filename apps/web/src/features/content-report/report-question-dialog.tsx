'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { CONTENT_REPORT_REASONS, CONTENT_REPORT_SLA_HOURS } from '@allingo/schemas';
import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, NativeSelect, Spinner, Textarea } from '@allingo/ui';
import { getErrorCode } from '@/lib/errors';
import { createContentReport, type ContentReportCreated } from '@/lib/s12-api';

type Reason = (typeof CONTENT_REPORT_REASONS)[number];

export function ReportQuestionDialog({ questionVersionId, number, onClose }: { questionVersionId: string; number?: number; onClose: (sent: boolean) => void }) {
  const t = useTranslations('contentReport');
  const te = useTranslations('errors');
  const fmt = useFormatter();
  const id = React.useId();
  const [reason, setReason] = React.useState<Reason>('wrong_answer');
  const [message, setMessage] = React.useState('');
  const [done, setDone] = React.useState<ContentReportCreated | null>(null);
  const send = useMutation({
    mutationFn: () => createContentReport({ question_version_id: questionVersionId, reason, ...(message.trim() ? { message: message.trim().slice(0, 2000) } : {}) }),
    onSuccess: setDone,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(!!done)} data-testid="report-dialog">
      <DialogContent>
        <DialogClose aria-label={t('close')} />
        <DialogHeader>
          <DialogTitle>{number ? t('titleNumber', { number }) : t('title')}</DialogTitle>
          <DialogDescription>{t('desc', { hours: CONTENT_REPORT_SLA_HOURS })}</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-4" role="status" data-testid="report-done" data-duplicate={done.duplicate}>
            <p className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <span>
                <span className="block font-semibold">{done.duplicate ? t('duplicate') : t('thanks')}</span>
                {t('slaLine', { date: fmt.dateTime(new Date(done.sla_due_at), { dateStyle: 'medium', timeStyle: 'short' }) })}
              </span>
            </p>
            <DialogFooter>
              <Button variant="navy" onClick={() => onClose(true)} data-testid="report-close">
                {t('close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!send.isPending) send.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-reason`}>{t('reason')}</Label>
              <NativeSelect id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value as Reason)} data-testid="report-reason">
                {CONTENT_REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`reasons.${r}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-msg`}>{t('message')}</Label>
              <Textarea id={`${id}-msg`} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} rows={4} placeholder={t('messagePlaceholder')} data-testid="report-message" />
            </div>
            {send.isError ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {te(`codes.${getErrorCode(send.error)}`)}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onClose(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" variant="navy" disabled={send.isPending} data-testid="report-submit">
                {send.isPending ? <Spinner aria-hidden /> : null}
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
