'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { adminCreditAdjustInputSchema } from '@allingo/schemas';
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Spinner, Textarea } from '@allingo/ui';
import { adjustUserCredits, adminKeys, listUserLedger, type CreditAdjustResult } from '@/lib/admin-api';
import { getErrorCode } from '@/lib/errors';
import { LedgerList } from '@/features/account/billing-page';
import { ErrorState } from '@/components/states';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cấp/trừ credit thủ công (ledger `admin_adjust`, ghi chú = lý do BẮT BUỘC, audit có admin id ở server) + sổ credit người dùng */
export function CreditsTab({ initialUserId }: { initialUserId: string }) {
  const t = useTranslations('admin');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [userId, setUserId] = React.useState(initialUserId);
  const [viewUser, setViewUser] = React.useState(UUID.test(initialUserId) ? initialUserId : '');
  const [delta, setDelta] = React.useState('');
  const [note, setNote] = React.useState('');
  const [expires, setExpires] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [last, setLast] = React.useState<CreditAdjustResult | null>(null);

  const ledger = useInfiniteQuery({
    queryKey: adminKeys.userLedger(viewUser),
    queryFn: ({ pageParam }) => listUserLedger(viewUser, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.next_cursor,
    enabled: UUID.test(viewUser),
  });

  const adjust = useMutation({
    mutationFn: (body: { delta: number; note: string; expires_at?: string }) => adjustUserCredits(userId.trim(), body),
    onSuccess: (r) => {
      setLast(r);
      toast.success(t('creditDone', { delta: r.delta, balance: r.balance_after }));
      setDelta('');
      setNote('');
      setExpires('');
      setViewUser(userId.trim());
      void qc.invalidateQueries({ queryKey: adminKeys.userLedger(userId.trim()) });
    },
    onError: (err) => setErrors({ form: getErrorCode(err) === 'conflict' ? t('creditOverdraw') : getErrorCode(err) === 'not_found' ? t('userNotFound') : te(`codes.${getErrorCode(err)}`) }),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!UUID.test(userId.trim())) errs.user = t('userIdInvalid');
    const expiresAt = expires ? new Date(`${expires}T23:59:59+07:00`).toISOString() : undefined;
    const parsed = adminCreditAdjustInputSchema.safeParse({ delta: Number(delta), note, ...(expiresAt ? { expires_at: expiresAt } : {}) });
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const k = String(i.path[0] ?? 'form');
        errs[k] ??= k === 'note' ? t('noteRequired') : k === 'delta' ? t('deltaInvalid') : t('invalid');
      }
    }
    if (expiresAt && Number(delta) < 0) errs.expires_at = t('expiresPositiveOnly');
    setErrors(errs);
    if (Object.keys(errs).length || !parsed.success) return;
    adjust.mutate(parsed.data);
  };

  const entries = ledger.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <Coins className="size-5 text-accent" aria-hidden />
            {t('creditTitle')}
          </CardTitle>
          <CardDescription>{t('creditDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit} noValidate data-testid="credit-form">
            <div className="space-y-1.5">
              <Label htmlFor="credit-user">{t('userId')}</Label>
              <Input id="credit-user" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" aria-invalid={errors.user ? true : undefined} data-testid="credit-user" />
              {errors.user ? <p className="text-xs text-destructive">{errors.user}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-delta">{t('delta')}</Label>
              <Input id="credit-delta" type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="100 / -50" aria-invalid={errors.delta ? true : undefined} data-testid="credit-delta" />
              {errors.delta ? <p className="text-xs text-destructive">{errors.delta}</p> : <p className="text-xs text-muted-foreground">{t('deltaHint')}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-note">
                {t('note')} <span className="text-destructive">*</span>
              </Label>
              <Textarea id="credit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t('noteHint')} aria-invalid={errors.note ? true : undefined} data-testid="credit-note" />
              {errors.note ? (
                <p className="text-xs text-destructive" data-testid="credit-note-error">
                  {errors.note}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-expires">{t('expiresAt')}</Label>
              <Input id="credit-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              {errors.expires_at ? <p className="text-xs text-destructive">{errors.expires_at}</p> : null}
            </div>
            {errors.form ? (
              <Alert variant="destructive" data-testid="credit-error">
                <AlertDescription>{errors.form}</AlertDescription>
              </Alert>
            ) : null}
            {last ? (
              <p className="text-sm text-success" data-testid="credit-result" data-balance={last.balance_after}>
                {t('creditDone', { delta: last.delta, balance: last.balance_after })}
              </p>
            ) : null}
            <Button type="submit" variant="navy" disabled={adjust.isPending} data-testid="credit-submit">
              {adjust.isPending ? <Spinner aria-hidden /> : null}
              {t('creditSubmit')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('userLedger')}</CardTitle>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setViewUser(userId.trim());
            }}
          >
            <Button type="submit" variant="outline" size="sm" disabled={!UUID.test(userId.trim())} data-testid="ledger-load">
              {t('loadLedger')}
            </Button>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {!UUID.test(viewUser) ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t('ledgerPick')}</p>
          ) : ledger.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : ledger.isError ? (
            <ErrorState error={ledger.error} className="m-4" />
          ) : entries.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <>
              <LedgerList entries={entries} testId="admin-ledger" />
              {ledger.hasNextPage ? (
                <div className="flex justify-center p-3">
                  <Button variant="outline" size="sm" disabled={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>
                    {tc('next')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
