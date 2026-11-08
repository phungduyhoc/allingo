'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { z } from 'zod';
import { Bell, CreditCard, Gift, ShieldCheck } from 'lucide-react';
import { isAdmin } from '@/features/admin/is-admin';
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
  Input,
  Label,
  NativeSelect,
} from '@allingo/ui';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { useEnrollments, useLogout, useMe, useUpdateMe, useUpsertEnrollment } from '@/lib/queries';
import { getErrorCode } from '@/lib/errors';
import type { Enrollment, Locale, User } from '@/lib/types';
import { CardSkeleton, ErrorState } from '@/components/states';
import { PageHeader } from '@/components/page-header';
import { FeatureGate } from '@/features/flags/flags-provider';

const LOCALES: Locale[] = ['vi', 'en', 'ja', 'ko', 'th'];
const PROGRAM = 'toeic';
const WEB_LOCALES = routing.locales as readonly string[];

export function SettingsPage() {
  const t = useTranslations('settings');
  const tnf = useTranslations('notifications');
  const tb = useTranslations('account');
  const tc = useTranslations('common');
  const router = useRouter();
  const me = useMe();
  const enrollments = useEnrollments();
  const logout = useLogout();
  const enrollment = enrollments.data?.find((e) => e.program === PROGRAM) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('profileTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {me.isPending ? (
              <CardSkeleton lines={4} className="border-0 p-0" />
            ) : me.isError ? (
              <ErrorState error={me.error} onRetry={() => void me.refetch()} />
            ) : (
              <ProfileForm key={me.data.id} user={me.data} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('goalTitle')}</CardTitle>
            <CardDescription>{t('goalDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {enrollments.isPending ? (
              <CardSkeleton lines={4} className="border-0 p-0" />
            ) : enrollments.isError ? (
              <ErrorState error={enrollments.error} onRetry={() => void enrollments.refetch()} />
            ) : (
              <GoalForm key={enrollment?.id ?? 'new'} enrollment={enrollment} />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{tnf('title')}</CardTitle>
            <CardDescription>{tnf('settingsLinkDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/settings/notifications"
              className={buttonVariants({ variant: 'outline' })}
              data-testid="notification-settings-link"
            >
              <Bell aria-hidden />
              {t('notificationsLink')}
            </Link>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{tb('settingsTitle')}</CardTitle>
            <CardDescription>{tb('settingsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/account/billing" className={buttonVariants({ variant: 'outline' })} data-testid="settings-billing-link">
              <CreditCard aria-hidden />
              {tb('settingsBilling')}
            </Link>
            {/* S11: kill-switch ff.growth.referral */}
            <FeatureGate flag="ff.growth.referral">
              <Link href="/referral" className={buttonVariants({ variant: 'outline' })} data-testid="settings-referral-link">
                <Gift aria-hidden />
                {tb('settingsReferral')}
              </Link>
            </FeatureGate>
            {isAdmin(me.data) ? (
              <Link href="/admin/billing" className={buttonVariants({ variant: 'outline' })} data-testid="settings-admin-link">
                <ShieldCheck aria-hidden />
                {tb('settingsAdmin')}
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('accountTitle')}</CardTitle>
            {me.data?.is_guest ? <CardDescription>{t('guestNote')}</CardDescription> : null}
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{me.data?.email ?? (me.data?.is_guest ? tc('guest') : '')}</p>
            <Button
              variant="outline"
              disabled={logout.isPending}
              onClick={() => {
                  // mutateAsync: qc.clear() trong useLogout làm AuthGate gỡ component này trước khi callback onSettled của
                  // mutate() kịp chạy (kẹt spinner) – promise vẫn hoàn tất sau khi gỡ nên chuyển trang chắc chắn
                  void logout.mutateAsync().catch(() => undefined).finally(() => router.replace('/'));
                }}
              data-testid="logout-button"
            >
              {t('logout')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProfileForm({ user }: { user: User }) {
  const t = useTranslations('settings');
  const tn = useTranslations('nav');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const updateMe = useUpdateMe();
  const [profile, setProfile] = React.useState({
    display_name: user.display_name,
    ui_locale: user.ui_locale,
    explain_locale: user.explain_locale,
  });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    updateMe.mutate(profile, {
      onSuccess: (updated) => {
        toast.success(t('saved'));
        // Đổi ngôn ngữ giao diện → điều hướng sang locale mới nếu web đã hỗ trợ
        if (updated.ui_locale !== locale && WEB_LOCALES.includes(updated.ui_locale)) {
          router.replace(pathname, { locale: updated.ui_locale });
        }
      },
      onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
    });
  };

  return (
    <form onSubmit={save} className="space-y-4" data-testid="profile-form">
      <div className="space-y-1.5">
        <Label htmlFor="display_name">{t('displayName')}</Label>
        <Input
          id="display_name"
          value={profile.display_name}
          maxLength={80}
          onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ui_locale">{t('uiLocale')}</Label>
          <NativeSelect
            id="ui_locale"
            value={profile.ui_locale}
            onChange={(e) => setProfile({ ...profile, ui_locale: e.target.value as Locale })}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l} disabled={!WEB_LOCALES.includes(l)}>
                {t(`locales.${l}`)}
                {!WEB_LOCALES.includes(l) ? ` (${tc('comingSoon')})` : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="explain_locale">{t('explainLocale')}</Label>
          <NativeSelect
            id="explain_locale"
            value={profile.explain_locale}
            onChange={(e) => setProfile({ ...profile, explain_locale: e.target.value as Locale })}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(`locales.${l}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="theme">{t('theme')}</Label>
        <NativeSelect id="theme" value={theme ?? 'system'} onChange={(e) => setTheme(e.target.value)}>
          <option value="system">{tn('themeSystem')}</option>
          <option value="light">{tn('themeLight')}</option>
          <option value="dark">{tn('themeDark')}</option>
        </NativeSelect>
      </div>
      <Button type="submit" variant="navy" disabled={updateMe.isPending}>
        {t('save')}
      </Button>
    </form>
  );
}

function GoalForm({ enrollment }: { enrollment: Enrollment | null }) {
  const t = useTranslations('settings');
  const te = useTranslations('errors');
  const upsert = useUpsertEnrollment();
  const [goal, setGoal] = React.useState({
    target_score: enrollment?.target_score?.toString() ?? '',
    exam_date: enrollment?.exam_date ?? '',
    daily_minutes: enrollment?.daily_minutes.toString() ?? '30',
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const schema = z.object({
      target_score: z.coerce
        .number()
        .min(10, { message: t('validation.targetScore') })
        .max(990, { message: t('validation.targetScore') })
        .optional(),
      exam_date: z.iso.date().optional(),
      daily_minutes: z.coerce
        .number()
        .int()
        .min(10, { message: t('validation.dailyMinutes') })
        .max(240, { message: t('validation.dailyMinutes') }),
    });
    const parsed = schema.safeParse({
      target_score: goal.target_score === '' ? undefined : goal.target_score,
      exam_date: goal.exam_date === '' ? undefined : goal.exam_date,
      daily_minutes: goal.daily_minutes,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    upsert.mutate(
      { input: { program: PROGRAM, ...parsed.data }, exists: !!enrollment },
      { onSuccess: () => toast.success(t('saved')), onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)) },
    );
  };

  return (
    <form onSubmit={save} className="space-y-4" data-testid="goal-form">
      {!enrollment ? (
        <Alert variant="info">
          <AlertDescription>{t('noEnrollment')}</AlertDescription>
        </Alert>
      ) : enrollment.days_to_exam !== null ? (
        <Badge variant="gold">{t('daysToExam', { count: enrollment.days_to_exam })}</Badge>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="target_score">{t('targetScore')}</Label>
          <Input
            id="target_score"
            type="number"
            inputMode="numeric"
            min={10}
            max={990}
            step={5}
            value={goal.target_score}
            aria-invalid={errors.target_score ? true : undefined}
            onChange={(e) => setGoal({ ...goal, target_score: e.target.value })}
          />
          {errors.target_score ? <p className="text-xs text-destructive">{errors.target_score}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exam_date">{t('examDate')}</Label>
          <Input
            id="exam_date"
            type="date"
            value={goal.exam_date}
            onChange={(e) => setGoal({ ...goal, exam_date: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="daily_minutes">{t('dailyMinutes')}</Label>
          <Input
            id="daily_minutes"
            type="number"
            inputMode="numeric"
            min={10}
            max={240}
            step={5}
            value={goal.daily_minutes}
            aria-invalid={errors.daily_minutes ? true : undefined}
            onChange={(e) => setGoal({ ...goal, daily_minutes: e.target.value })}
          />
          {errors.daily_minutes ? <p className="text-xs text-destructive">{errors.daily_minutes}</p> : null}
        </div>
      </div>
      <Button type="submit" variant="navy" disabled={upsert.isPending}>
        {t('saveGoal')}
      </Button>
    </form>
  );
}
