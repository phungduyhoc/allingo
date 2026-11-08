'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BellOff, BellRing, Plus, Smartphone, Trash2, TriangleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { NOTIFICATION_CHANNELS, type NotificationPreferences } from '@allingo/schemas/api/learning-tools';
import { CategoryMatrix } from '@/features/notifications/category-matrix';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  Spinner,
  Switch,
} from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { getErrorCode } from '@/lib/errors';
import {
  deletePushSubscription,
  getNotificationPreferences,
  listPushSubscriptions,
  patchNotificationPreferences,
} from '@/lib/learning-api';
import { PUSH_SUBS_KEY, usePush } from './use-push';

const PREFS_KEY = ['me', 'notification-preferences'] as const;
const MAX_REMINDERS = 5;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Kênh hiển thị (sms chưa dùng ở GĐ1) */
const SHOWN_CHANNELS = NOTIFICATION_CHANNELS.filter((c) => c !== 'sms');

/** Cài đặt thông báo: kênh, giờ yên lặng, giờ nhắc học (GET/PATCH /me/notification-preferences) + Web Push thiết bị này */
export function NotificationSettingsPage() {
  const t = useTranslations('notifications');
  const tn = useTranslations('nav');
  const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: getNotificationPreferences });
  return (
    <div className="space-y-6" data-testid="notification-settings">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Link href="/settings" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden />
            {tn('settings')}
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <PushCard />
        <Card>
          <CardHeader>
            <CardTitle>{t('channelsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {prefs.isPending ? (
              <CardSkeleton lines={4} className="border-0 p-0" />
            ) : prefs.isError ? (
              <ErrorState error={prefs.error} title={t('loadError')} onRetry={() => void prefs.refetch()} />
            ) : (
              <PrefsForm key={prefs.data.updated_at ?? 'p'} prefs={prefs.data} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PrefsForm({ prefs }: { prefs: NotificationPreferences }) {
  const t = useTranslations('notifications');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [channels, setChannels] = React.useState(prefs.channels);
  const [quiet, setQuiet] = React.useState(prefs.quiet_hours);
  const [times, setTimes] = React.useState<string[]>(prefs.reminder_times);
  // S8: bật/tắt theo loại × kênh (API cũ không trả `categories` → ẩn ma trận, không gửi)
  const [categories, setCategories] = React.useState(prefs.categories ?? null);
  const save = useMutation({
    mutationFn: () =>
      patchNotificationPreferences({ channels, quiet_hours: quiet, reminder_times: [...new Set(times)].sort(), ...(categories ? { categories } : {}) }),
    onSuccess: (p) => {
      qc.setQueryData(PREFS_KEY, p);
      toast.success(t('saved'));
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });
  const valid = HHMM.test(quiet.start) && HHMM.test(quiet.end) && times.every((x) => HHMM.test(x));
  const id = React.useId();

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="sr-only">{t('channelsTitle')}</legend>
        {SHOWN_CHANNELS.map((c) => (
          <div key={c} className="flex items-center justify-between gap-3">
            <span id={`${id}-${c}`} className="text-sm font-medium">
              {t(`channel.${c}`)}
            </span>
            <Switch
              checked={!!channels[c]}
              onCheckedChange={(v) => setChannels((x) => ({ ...x, [c]: v }))}
              aria-labelledby={`${id}-${c}`}
              data-testid={`channel-${c}`}
            />
          </div>
        ))}
      </fieldset>

      {categories ? <CategoryMatrix value={categories} onChange={setCategories} channels={channels} /> : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t('quietTitle')}</legend>
        <p className="text-xs text-muted-foreground">{t('quietDesc')}</p>
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-qs`}>{t('quietStart')}</Label>
            <Input
              id={`${id}-qs`}
              type="time"
              value={quiet.start}
              onChange={(e) => setQuiet((q) => ({ ...q, start: e.target.value }))}
              className="w-32"
              required
              data-testid="quiet-start"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-qe`}>{t('quietEnd')}</Label>
            <Input
              id={`${id}-qe`}
              type="time"
              value={quiet.end}
              onChange={(e) => setQuiet((q) => ({ ...q, end: e.target.value }))}
              className="w-32"
              required
              data-testid="quiet-end"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t('remindersTitle')}</legend>
        <ul className="flex flex-wrap gap-2">
          {times.map((tm, i) => (
            <li key={i} className="flex items-center gap-1">
              <Label htmlFor={`${id}-r${i}`} className="sr-only">
                {t('reminderLabel', { index: i + 1 })}
              </Label>
              <Input
                id={`${id}-r${i}`}
                type="time"
                value={tm}
                onChange={(e) => setTimes((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                className="w-32"
                aria-invalid={!HHMM.test(tm) || undefined}
                data-testid="reminder-time"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setTimes((xs) => xs.filter((_, j) => j !== i))}
                aria-label={t('removeReminder', { time: tm })}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTimes((xs) => [...xs, '20:00'])}
          disabled={times.length >= MAX_REMINDERS}
          data-testid="reminder-add"
        >
          <Plus aria-hidden />
          {t('addReminder')}
        </Button>
        {times.length >= MAX_REMINDERS ? (
          <p className="text-xs text-muted-foreground">{t('remindersMax', { max: MAX_REMINDERS })}</p>
        ) : null}
        {!valid ? <p className="text-xs text-destructive">{t('reminderInvalid')}</p> : null}
      </fieldset>

      <Button type="submit" variant="navy" disabled={!valid || save.isPending} data-testid="prefs-save">
        {save.isPending ? <Spinner aria-hidden /> : null}
        {t('save')}
      </Button>
    </form>
  );
}

function PushCard() {
  const t = useTranslations('notifications');
  const fmt = useFormatter();
  const qc = useQueryClient();
  const { state, enable, disable } = usePush();
  const devices = useQuery({ queryKey: PUSH_SUBS_KEY, queryFn: listPushSubscriptions });
  const remove = useMutation({
    mutationFn: deletePushSubscription,
    onSuccess: () => void qc.invalidateQueries({ queryKey: PUSH_SUBS_KEY }),
  });
  const errText = state.error
    ? state.error.kind === 'denied'
      ? t('pushDenied')
      : state.error.kind === 'server_disabled'
        ? t('pushServerDisabled')
        : state.error.kind === 'no_worker'
          ? t('pushNoWorker')
          : t('pushError')
    : null;

  return (
    <Card
      data-testid="push-card"
      data-subscribed={state.subscribed}
      data-permission={state.permission ?? ''}
      data-support={state.support ?? ''}
    >
      <CardHeader>
        <CardTitle>{t('pushTitle')}</CardTitle>
        <CardDescription>{t('pushDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.support === null ? (
          <CardSkeleton lines={1} className="border-0 p-0" />
        ) : state.support === 'unsupported' ? (
          <p className="text-sm text-muted-foreground" data-testid="push-unsupported">
            {t('pushUnsupported')}
          </p>
        ) : state.support === 'ios-install' ? (
          <p className="text-sm text-muted-foreground" data-testid="push-ios">
            {t('pushIosHint')}
          </p>
        ) : state.subscribed ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-success" data-testid="push-enabled">
              <BellRing className="size-4" aria-hidden />
              {t('pushEnabled')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void disable()}
              disabled={state.busy}
              data-testid="push-disable"
            >
              {state.busy ? <Spinner aria-hidden /> : <BellOff aria-hidden />}
              {t('pushDisable')}
            </Button>
          </div>
        ) : (
          <Button
            variant="navy"
            onClick={() => void enable()}
            disabled={state.busy || state.permission === 'denied'}
            data-testid="push-enable"
          >
            {state.busy ? <Spinner aria-hidden /> : <BellRing aria-hidden />}
            {state.busy ? t('pushWorking') : t('pushEnable')}
          </Button>
        )}
        {state.permission === 'denied' && !state.error ? (
          <p className="text-sm text-muted-foreground">{t('pushDenied')}</p>
        ) : null}
        {errText ? (
          <Alert
            variant={state.error?.kind === 'failed' ? 'destructive' : 'gold'}
            data-testid="push-error"
            data-kind={state.error?.kind}
          >
            <TriangleAlert aria-hidden />
            <AlertDescription>
              {errText}
              {state.error?.message ? (
                <span className="mt-1 block text-xs opacity-80">
                  {t('pushErrorDetail', { message: state.error.message })}
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-semibold">{t('devicesTitle')}</p>
          {devices.isPending ? (
            <CardSkeleton lines={1} className="border-0 p-0" />
          ) : devices.isError ? null : devices.data.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="push-devices-empty">
              {t('devicesEmpty')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="push-devices">
              {devices.data.map((d) => (
                <li
                  key={d.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm',
                    d.id === state.deviceId && 'border-primary/40 bg-primary/5',
                  )}
                  data-testid="push-device"
                >
                  <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{shortUa(d.user_agent) ?? t('unknownDevice')}</span>
                    <span className="block text-xs text-muted-foreground">
                      {d.endpoint_origin} ·{' '}
                      {t('deviceAdded', { date: fmt.dateTime(new Date(d.created_at), { dateStyle: 'medium' }) })}
                    </span>
                  </span>
                  {d.id === state.deviceId ? <Badge variant="secondary">{t('thisDevice')}</Badge> : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => (d.id === state.deviceId ? void disable() : remove.mutate(d.id))}
                    disabled={remove.isPending || state.busy}
                    aria-label={t('removeDevice')}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** "Chrome · Windows" từ user agent (gọn, chỉ hiển thị) */
function shortUa(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /CriOS|Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return [browser, os].filter(Boolean).join(' · ') || null;
}
