'use client';

import * as React from 'react';
import { BookOpen, Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, Button, cn, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@allingo/ui';
import { QuotaExceededNotice } from '@/features/quota/quota-ui';
import { useLocalized } from '@/lib/localized';
import { getErrorCode } from '@/lib/errors';
import type { AttemptMode } from '@/lib/types';
import type { useStartTestSet } from './use-start-test-set';

type Ctl = ReturnType<typeof useStartTestSet>;

export function StartAttemptDialog({ ctl }: { ctl: Ctl }) {
  const t = useTranslations('testSets');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const L = useLocalized();
  const [mode, setMode] = React.useState<AttemptMode>('exam');
  const summary = ctl.target?.summary;
  const err = ctl.create.error;
  const code = err ? getErrorCode(err) : null;

  return (
    <Dialog open={!!summary} onOpenChange={(o) => (!o ? ctl.setTarget(null) : undefined)}>
      <DialogContent>
        <DialogClose aria-label={tc('close')} />
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{summary ? t('dialogDesc', { title: L(summary.title), count: summary.question_count }) : null}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label={t('dialogTitle')} className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['exam', Timer, t('modeExam'), t('modeExamDesc')],
              ['practice', BookOpen, t('modePractice'), t('modePracticeDesc')],
            ] as const
          ).map(([value, Icon, label, desc]) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`mode-${value}`}
                onClick={() => setMode(value)}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                  selected ? 'border-navy bg-navy/5 dark:border-accent dark:bg-accent/10' : 'border-border hover:bg-muted',
                )}
              >
                <Icon className={cn('size-5', selected ? 'text-navy dark:text-accent' : 'text-muted-foreground')} aria-hidden />
                <span className="font-semibold">{label}</span>
                <span className="text-sm text-muted-foreground">{desc}</span>
              </button>
            );
          })}
        </div>
        {code === 'quota_exceeded' ? (
          <QuotaExceededNotice error={err} />
        ) : code ? (
          <Alert variant="destructive">
            <AlertDescription>{te(`codes.${code}`)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => ctl.setTarget(null)}>
            {tc('cancel')}
          </Button>
          <Button variant="navy" onClick={() => ctl.start(mode)} disabled={ctl.create.isPending} data-testid="start-attempt">
            {ctl.create.isPending ? t('starting') : t('dialogStart')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
