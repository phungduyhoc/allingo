'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarClock, Coins, KeyRound, LifeBuoy, Sparkles } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Alert, AlertDescription, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input, Label, Spinner } from '@allingo/ui';
import { BETA_DEFAULTS } from '@allingo/schemas/api/s12';
import { Link, useRouter } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { isApiError } from '@/lib/errors';
import { betaNextPath, formatInviteCodeInput, hasAmbiguousChars, isCompleteInviteCode, redeemErrorKey } from '@/lib/beta';
import { getBetaStatus, redeemBetaCode, s12Keys, type BetaRedeemResult } from '@/lib/s12-api';
import { useClientValue } from '@/lib/use-mounted';
import { WaitlistForm } from '@/features/marketing/waitlist-form';
import { FeedbackButton } from '@/features/feedback/feedback-button';

/**
 * Trang beta kín `/beta` (S12): nơi listener của khu vực học chuyển tới khi API trả 403 `beta_required`, đích của email mời
 * (`/beta?code=ALG-…`). Không nằm sau AuthGate – xử lý cả khách ẩn danh (mời đăng ký/đăng nhập, giữ `?code=` qua `?next=`),
 * tài khoản khách (cần tạo tài khoản), người đã có quyền (vào học / làm khảo sát) và người cần nhập mã. Quyền lợi hiển thị theo
 * PHẢN HỒI của API (`trial_ends_at`, `credits_granted`, `balance`, `trial_skipped`) – không tự tính.
 */
export function BetaPage() {
  const t = useTranslations('beta');
  const me = useMe();
  const status = useQuery({ queryKey: [...s12Keys.betaStatus, me.data?.id ?? 'anon'], queryFn: getBetaStatus, enabled: !me.isPending, staleTime: 10_000 });
  // Chuỗi query (giá trị ổn định cho useSyncExternalStore) → URLSearchParams
  const search = useClientValue<string | null>(() => window.location.search, null);
  const query = React.useMemo(() => (search === null ? null : new URLSearchParams(search)), [search]);
  const initialCode = query?.get('code') ?? '';
  const next = betaNextPath(query?.get('next'));
  const anonymous = me.isError && isApiError(me.error) && me.error.status === 401;
  const user = me.data;
  const [redeemed, setRedeemed] = React.useState<BetaRedeemResult | null>(null);

  const loading = me.isPending || (!anonymous && !me.isError && status.isPending) || query === null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16" data-testid="beta-page">
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <section aria-labelledby="beta-title" className="space-y-6">
          <Badge variant="gold" className="text-sm">
            <Sparkles aria-hidden />
            {t('badge')}
          </Badge>
          <h1 id="beta-title" className="text-3xl font-extrabold tracking-tight text-navy sm:text-4xl dark:text-foreground">
            {t('title')}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">{t('subtitle')}</p>
          <ul className="grid gap-3 sm:grid-cols-2" aria-label={t('perksLabel')}>
            <Perk icon={BadgeCheck} title={t('perkPro', { days: BETA_DEFAULTS.trial_days })} desc={t('perkProDesc')} />
            <Perk icon={Coins} title={t('perkCredits', { credits: BETA_DEFAULTS.credits })} desc={t('perkCreditsDesc')} />
            <Perk icon={CalendarClock} title={t('perkTwoWeeks')} desc={t('perkTwoWeeksDesc')} />
            <Perk icon={LifeBuoy} title={t('perkSupport')} desc={t('perkSupportDesc')} />
          </ul>
          <p className="text-xs text-muted-foreground">{t('perksNote')}</p>
        </section>

        <div className="space-y-6">
          {loading ? (
            <Card>
              <CardContent className="flex justify-center py-12">
                <Spinner label={t('loading')} />
              </CardContent>
            </Card>
          ) : redeemed ? (
            <RedeemSuccess result={redeemed} next={next} />
          ) : anonymous ? (
            <SignInFirst code={initialCode} />
          ) : me.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{t('loadError')}</AlertDescription>
            </Alert>
          ) : user?.is_guest ? (
            <SignInFirst code={initialCode} guest />
          ) : status.data?.has_access && status.data.reason !== 'gate_off' ? (
            <HasAccess reason={status.data.reason} trialEndsAt={status.data.trial_ends_at} surveyDone={status.data.survey_completed === true} next={next} />
          ) : (
            <RedeemCard key={initialCode} initialCode={initialCode} gateOff={status.data?.gate_enabled === false} onRedeemed={setRedeemed} />
          )}
          {!user || user.is_guest || (status.data && !status.data.has_access) ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('noCodeTitle')}</CardTitle>
                <CardDescription>{t('noCodeDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <WaitlistForm program="toeic" />
              </CardContent>
            </Card>
          ) : null}
          {user && !user.is_guest ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {t('needHelp')}{' '}
                <Link href="/support" className="font-semibold text-primary underline-offset-4 hover:underline" data-testid="beta-support-link">
                  {t('contactSupport')}
                </Link>
              </p>
              {/* B6/S150: góp ý miễn beta gate – gửi được ngay cả khi chưa có mã; chưa có quyền → không đính ảnh (presign có gate) */}
              <FeedbackButton examAware={false} allowScreenshot={status.data?.has_access === true} variant="outline" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Perk({ icon: Icon, title, desc }: { icon: typeof Coins; title: string; desc: string }) {
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-accent-foreground dark:text-accent" aria-hidden />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{desc}</span>
      </span>
    </li>
  );
}

function SignInFirst({ code, guest = false }: { code: string; guest?: boolean }) {
  const t = useTranslations('beta');
  const back = `/beta${code ? `?code=${encodeURIComponent(code)}` : ''}`;
  const q = `?next=${encodeURIComponent(back)}`;
  return (
    <Card data-testid="beta-signin">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="size-5" aria-hidden />
          {guest ? t('guestTitle') : t('signInTitle')}
        </CardTitle>
        <CardDescription>{guest ? t('guestDesc') : t('signInDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Link href={`/signup${q}`} className={buttonVariants({ variant: 'navy' })} data-testid="beta-signup">
          {t('signUp')}
        </Link>
        {guest ? null : (
          <Link href={`/login${q}`} className={buttonVariants({ variant: 'outline' })} data-testid="beta-login">
            {t('logIn')}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function HasAccess({ reason, trialEndsAt, surveyDone, next }: { reason: string; trialEndsAt: string | null; surveyDone: boolean; next: string }) {
  const t = useTranslations('beta');
  const fmt = useFormatter();
  return (
    <Card className="border-success/40" data-testid="beta-has-access" data-reason={reason}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BadgeCheck className="size-5 text-success" aria-hidden />
          {t('hasAccessTitle')}
        </CardTitle>
        <CardDescription>{reason === 'invite' ? t('hasAccessInvite') : t('hasAccessOther')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {trialEndsAt ? <p className="text-sm">{t('trialUntil', { date: fmt.dateTime(new Date(trialEndsAt), { dateStyle: 'long' }) })}</p> : null}
        <div className="flex flex-wrap gap-2">
          {!surveyDone && reason === 'invite' ? (
            <Link href={`/onboarding/beta?next=${encodeURIComponent(next)}`} className={buttonVariants({ variant: 'navy' })} data-testid="beta-survey-link">
              {t('startSurvey')}
            </Link>
          ) : null}
          <Link href={next} className={buttonVariants({ variant: surveyDone || reason !== 'invite' ? 'navy' : 'outline' })} data-testid="beta-continue">
            {t('goLearn')}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function RedeemCard({ initialCode, gateOff, onRedeemed }: { initialCode: string; gateOff: boolean; onRedeemed: (r: BetaRedeemResult) => void }) {
  const t = useTranslations('beta');
  const qc = useQueryClient();
  const [code, setCode] = React.useState(() => formatInviteCodeInput(initialCode));
  const id = React.useId();
  const redeem = useMutation({
    mutationFn: (c: string) => redeemBetaCode(c),
    // Lỗi hiển thị tại chỗ (không toast chung) – kể cả 429 bucket beta_redeem
    meta: { inlineErrors: true },
    onSuccess: (r) => {
      // Quyền beta có hiệu lực ngay ở server (cache Redis) – làm mới /me, entitlements, credit, trạng thái beta
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: s12Keys.betaStatus });
      onRedeemed(r);
    },
  });
  const complete = isCompleteInviteCode(code);
  const errKey = redeem.isError ? redeemErrorKey(redeem.error) : null;
  return (
    <Card data-testid="beta-redeem">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="size-5" aria-hidden />
          {t('redeemTitle')}
        </CardTitle>
        <CardDescription>{gateOff ? t('redeemDescGateOff') : t('redeemDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete && !redeem.isPending) redeem.mutate(code);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-code`}>{t('codeLabel')}</Label>
            <Input
              id={`${id}-code`}
              value={code}
              onChange={(e) => {
                setCode(formatInviteCodeInput(e.target.value));
                if (redeem.isError) redeem.reset();
              }}
              placeholder={t('codePlaceholder')}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              maxLength={13}
              className="h-12 font-mono text-lg tracking-[0.15em] uppercase"
              aria-describedby={`${id}-hint${errKey ? ` ${id}-err` : ''}`}
              aria-invalid={errKey ? true : undefined}
              data-testid="beta-code-input"
            />
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {hasAmbiguousChars(code) ? t('codeAmbiguous') : t('codeHint')}
            </p>
          </div>
          {errKey ? (
            <p id={`${id}-err`} role="alert" className="text-sm font-medium text-destructive" data-testid="beta-redeem-error" data-reason={errKey}>
              {t(`redeemErrors.${errKey}`)}
            </p>
          ) : null}
          <Button type="submit" variant="navy" size="lg" className="w-full" disabled={!complete || redeem.isPending} data-testid="beta-redeem-submit">
            {redeem.isPending ? <Spinner aria-hidden /> : null}
            {t('redeemSubmit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RedeemSuccess({ result, next }: { result: BetaRedeemResult; next: string }) {
  const t = useTranslations('beta');
  const fmt = useFormatter();
  const router = useRouter();
  const target = result.survey_pending ? `/onboarding/beta?next=${encodeURIComponent(next)}` : next;
  return (
    <Card className="border-success/50" data-testid="beta-redeemed" data-status={result.status}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg" role="status">
          <BadgeCheck className="size-5 text-success" aria-hidden />
          {result.status === 'already_redeemed' ? t('alreadyRedeemedTitle') : t('redeemedTitle')}
        </CardTitle>
        <CardDescription>{t('redeemedDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-muted px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t('trialLabel')}</dt>
            <dd className="font-semibold" data-testid="beta-trial">
              {result.trial_skipped === 'already_pro'
                ? t('trialSkipped')
                : result.trial_ends_at
                  ? t('trialUntil', { date: fmt.dateTime(new Date(result.trial_ends_at), { dateStyle: 'long' }) })
                  : '—'}
            </dd>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t('creditsLabel')}</dt>
            <dd className="font-semibold tabular" data-testid="beta-credits">
              {t('creditsGranted', { credits: fmt.number(result.credits_granted), balance: fmt.number(result.balance) })}
            </dd>
          </div>
        </dl>
        <Button variant="navy" size="lg" className={cn('w-full')} onClick={() => router.push(target)} data-testid="beta-redeemed-continue">
          {result.survey_pending ? t('startSurvey') : t('goLearn')}
        </Button>
      </CardContent>
    </Card>
  );
}
