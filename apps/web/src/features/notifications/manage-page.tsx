'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailX, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { NotificationManage } from '@allingo/schemas/api/growth';
import type { NotificationCategories } from '@allingo/schemas/api/learning-tools';
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner, Switch } from '@allingo/ui';
import { getErrorCode, getErrorStatus } from '@/lib/errors';
import { getNotificationManage, growthKeys, patchNotificationManage, type ManagePatch } from '@/lib/growth-api';
import { CardSkeleton } from '@/components/states';
import { CategoryMatrix } from './category-matrix';

type Scope = 'learning' | 'billing' | 'marketing' | 'all';
const SCOPES: readonly Scope[] = ['learning', 'billing', 'marketing', 'all'];

/**
 * Trang quản lý thông báo từ link trong email (`/notifications/manage?token=&unsubscribe=<category>`) – KHÔNG cần đăng nhập
 * (token HMAC do API ký). Mở trang không đổi gì (trình duyệt/email client có thể tải trước link) – người dùng bấm
 * "Huỷ đăng ký" mới gửi PATCH. Email giao dịch (biên lai, hoá đơn) luôn được gửi.
 */
export function ManageNotificationsPage() {
  const t = useTranslations('notifications.manage');
  const tn = useTranslations('notifications');
  const te = useTranslations('errors');
  const search = useSearchParams();
  const token = search.get('token') ?? '';
  const unsub = search.get('unsubscribe');
  const scope = (SCOPES as readonly string[]).includes(unsub ?? '') ? (unsub as Scope) : null;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: growthKeys.manage(token), queryFn: () => getNotificationManage(token), enabled: token.length >= 20, retry: false });
  const [draft, setDraft] = React.useState<{ categories: NotificationCategories; email: boolean } | null>(null);
  const [done, setDone] = React.useState<Scope | null>(null);

  const patch = useMutation({
    mutationFn: (body: ManagePatch) => patchNotificationManage(token, body),
    onSuccess: (data) => {
      qc.setQueryData<NotificationManage>(growthKeys.manage(token), data);
      setDraft(null);
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });

  if (!token || token.length < 20) return <InvalidLink />;
  if (q.isPending) return <CardSkeleton lines={5} />;
  if (q.isError) return getErrorStatus(q.error) === 400 || getErrorStatus(q.error) === 404 ? <InvalidLink /> : <Alert variant="destructive"><AlertDescription>{te(`codes.${getErrorCode(q.error)}`)}</AlertDescription></Alert>;

  const data = q.data;
  const categories = data.categories ?? { learning: { email: true, push: true, inapp: true }, billing: { email: true, push: true, inapp: true }, marketing: { email: false, push: false, inapp: true } };
  const view = draft ?? { categories, email: data.channels.email !== false };
  const scopeLabel = (s: Scope) => (s === 'all' ? t('allEmails') : tn(`category.${s}`));
  const scopeOn = scope ? (scope === 'all' ? view.email && Object.values(categories).some((c) => c.email) : categories[scope].email) : false;

  const unsubscribe = (s: Scope) => {
    const body: ManagePatch = s === 'all' ? { categories: { learning: { email: false }, billing: { email: false }, marketing: { email: false } } } : { categories: { [s]: { email: false } } };
    patch.mutate(body, { onSuccess: () => setDone(s) });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="manage-page">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">
          {data.email_masked ? t('forEmail', { email: data.email_masked }) : t('subtitle')}
          {data.email_masked ? <span className="sr-only" data-testid="manage-email">{data.email_masked}</span> : null}
        </p>
      </header>

      {done ? (
        <Alert variant="default" data-testid="manage-unsubscribed" data-scope={done}>
          <ShieldCheck aria-hidden />
          <AlertTitle>{t('doneTitle')}</AlertTitle>
          <AlertDescription>{t('doneDesc', { category: scopeLabel(done) })}</AlertDescription>
        </Alert>
      ) : scope && scopeOn ? (
        <Card data-testid="manage-unsubscribe-card" data-scope={scope}>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <MailX className="size-5 text-muted-foreground" aria-hidden />
              {t('unsubTitle', { category: scopeLabel(scope) })}
            </CardTitle>
            <CardDescription>{t('unsubDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="navy" disabled={patch.isPending} onClick={() => unsubscribe(scope)} data-testid="manage-unsubscribe">
              {patch.isPending ? <Spinner aria-hidden /> : null}
              {t('unsubCta')}
            </Button>
          </CardContent>
        </Card>
      ) : scope ? (
        <Alert data-testid="manage-already" data-scope={scope}>
          <AlertDescription>{t('alreadyOff', { category: scopeLabel(scope) })}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('prefsTitle')}</CardTitle>
          <CardDescription>{t('prefsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <span id="manage-email-master" className="text-sm font-medium">
              {t('emailMaster')}
            </span>
            <Switch checked={view.email} onCheckedChange={(v) => setDraft({ ...view, email: v })} aria-labelledby="manage-email-master" data-testid="manage-email-master" />
          </div>
          <CategoryMatrix value={view.categories} onChange={(c) => setDraft({ ...view, categories: c })} channels={{ email: view.email }} />
          <Button
            variant="navy"
            disabled={!draft || patch.isPending}
            onClick={() => patch.mutate({ categories: view.categories, channels: { email: view.email } }, { onSuccess: () => toast.success(t('saved')) })}
            data-testid="manage-save"
          >
            {patch.isPending ? <Spinner aria-hidden /> : null}
            {t('save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function InvalidLink() {
  const t = useTranslations('notifications.manage');
  return (
    <Alert variant="destructive" className="mx-auto max-w-xl" data-testid="manage-invalid">
      <AlertTitle>{t('invalidTitle')}</AlertTitle>
      <AlertDescription>{t('invalidDesc')}</AlertDescription>
    </Alert>
  );
}
