'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Coins, Crown, Gift, Minus, Sparkles, Tag, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { type PromotionValidateResult } from '@allingo/schemas/api/billing';
import { PROGRAM_CODES, type ProgramCode } from '@allingo/schemas/common';
import { FEATURE_GATES, GATE_KEYS, type GateKey } from '@allingo/schemas/product/entitlements';
import { Alert, AlertDescription, Badge, Button, buttonVariants, cn, Input, Label, Spinner, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useFlag } from '@/features/flags/flags-provider';
import { billingKeys, getPaymentProviders, getPlans, redeemPromotion, validatePromotion } from '@/lib/billing-api';
import { TRIAL_PROMO_CODE, formatVnd, groupPlans, monthlyEquivalent, priceView, promotionReasonOf, type Plan } from '@/lib/billing';
import { getErrorCode } from '@/lib/errors';
import { useLocalized } from '@/lib/localized';
import { queryKeys, useEntitlements, useMe } from '@/lib/queries';
import { ErrorState } from '@/components/states';

type Period = 'monthly' | 'yearly' | 'lifetime';
const PERIODS: Period[] = ['monthly', 'yearly', 'lifetime'];
/** Hàng so sánh quyền lợi (bỏ gate nội bộ `plan_adjust` – trùng quyền study_plan) */
const COMPARE_GATES = GATE_KEYS.filter((k) => k !== 'plan_adjust');

const isProgram = (v: string | null): v is ProgramCode => !!v && (PROGRAM_CODES as readonly string[]).includes(v);

export function PricingClient() {
  const t = useTranslations('pricing');
  const tb = useTranslations('billing');
  const te = useTranslations('errors');
  const locale = useLocale();
  const loc = useLocalized();
  const search = useSearchParams();
  const qc = useQueryClient();
  const [program, setProgram] = React.useState<ProgramCode>(() => (isProgram(search.get('program')) ? (search.get('program') as ProgramCode) : 'toeic'));
  const [period, setPeriod] = React.useState<Period>('monthly');
  const [code, setCode] = React.useState(() => search.get('promo')?.toUpperCase() ?? '');
  const [applied, setApplied] = React.useState<string | null>(() => search.get('promo')?.toUpperCase() || null);

  const me = useMe({ retry: false });
  const user = me.data;
  const signedIn = !!user && !user.is_guest;
  const plans = useQuery({ queryKey: billingKeys.plans(program), queryFn: () => getPlans(program), staleTime: 5 * 60_000 });
  const providers = useQuery({ queryKey: billingKeys.providers, queryFn: getPaymentProviders, staleTime: 60_000 });
  const ent = useEntitlements(program, { enabled: signedIn });
  const groups = plans.data ? groupPlans(plans.data, program) : null;
  const periods = PERIODS.filter((p) => !!groups?.[p]);
  const activePeriod = periods.includes(period) ? period : (periods[0] ?? 'monthly');
  const pro = groups?.[activePeriod] ?? null;
  const paidPlans = groups ? [groups.monthly, groups.yearly, groups.lifetime, groups.combo, ...groups.creditPacks].filter((p): p is Plan => !!p?.price) : [];
  // S11: kill-switch ff.billing.checkout (GET /flags) – tắt → ẩn nút mua ngay cả khi /payments/providers còn bản cũ
  const checkoutFlag = useFlag('ff.billing.checkout');
  const checkoutOpen = checkoutFlag && (providers.data ? providers.data.checkout_enabled && providers.data.providers.length > 0 : true);

  // Xem trước mã: server tính giá cho từng gói (mã chỉ áp một gói/đơn, không cộng dồn)
  const priceIds = paidPlans.map((p) => p.price!.id);
  const promo = useQuery({
    queryKey: ['promotions', 'preview', applied, program, priceIds.join(',')],
    enabled: !!applied && signedIn && priceIds.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(priceIds.map(async (id) => [id, await validatePromotion({ code: applied!, price_id: id, program })] as const));
      return Object.fromEntries(entries);
    },
    staleTime: 60_000,
  });
  const trial = useQuery({
    queryKey: ['promotions', 'trial', program, user?.id],
    enabled: signedIn,
    queryFn: () => validatePromotion({ code: TRIAL_PROMO_CODE, program }),
    staleTime: 60_000,
  });
  // Chưa đăng nhập / khách → nút dẫn đi đăng ký; đã đăng nhập → chỉ hiện khi server nói còn đổi được (chưa dùng thử, chưa Pro)
  const trialEligible = !signedIn || (!!trial.data && (trial.data.valid || trial.data.reason === 'requires_redeem'));

  const redeem = useMutation({
    mutationFn: (c: string) => redeemPromotion({ code: c, program }),
    onSuccess: (r) => {
      if (r.kind === 'trial_days') toast.success(tb('trial.started', { date: r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-GB') : '' }));
      else toast.success(tb('promo.creditsGranted', { credits: r.credits_granted }));
      void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
      void qc.invalidateQueries({ queryKey: billingKeys.subscriptions });
      void qc.invalidateQueries({ queryKey: billingKeys.credits });
      void qc.invalidateQueries({ queryKey: ['promotions'] });
    },
    onError: (err) => {
      const reason = promotionReasonOf(err);
      toast.error(reason ? tb(`promoReason.${reason}`) : te(`codes.${getErrorCode(err)}`));
    },
  });

  const resultFor = (priceId: string | undefined) => (priceId && promo.data ? (promo.data[priceId] ?? null) : null);
  const promoValidFor = (priceId: string | undefined) => {
    const r = resultFor(priceId);
    return !!r && r.valid && (r.applies_to ?? 'order') === 'order';
  };
  const checkoutHref = (priceId: string) => {
    const q = new URLSearchParams({ price_id: priceId });
    if (applied && promoValidFor(priceId)) q.set('promo', applied);
    return `/checkout?${q.toString()}`;
  };
  const buyHref = (priceId: string) => (signedIn ? checkoutHref(priceId) : `/signup?next=${encodeURIComponent(checkoutHref(priceId))}`);
  const currentKind = signedIn && ent.data ? ((ent.data as { plan_kind?: string }).plan_kind ?? (ent.data.is_pro ? 'pro' : 'free')) : null;

  // Thông điệp mã khuyến mãi: hợp lệ cho ít nhất một gói → tên mã; không → lý do theo gói Pro đang chọn
  const anyResult = promo.data ? Object.values(promo.data) : [];
  const anyValid = anyResult.find((r) => r.valid && (r.applies_to ?? 'order') === 'order');
  const redeemable = anyResult.find((r) => (r.applies_to === 'redeem' && (r.valid || r.reason === 'requires_redeem')) || r.reason === 'requires_redeem');
  const shownReason = resultFor(pro?.price?.id)?.reason ?? anyResult[0]?.reason ?? null;

  return (
    <div className="space-y-10">
      <div className="flex flex-col items-center gap-4">
        <Tabs value={program} onValueChange={(v) => setProgram(v as ProgramCode)}>
          <TabsList aria-label={t('programLabel')}>
            {PROGRAM_CODES.map((p) => (
              <TabsTrigger key={p} value={p} data-testid={`program-${p}`}>
                {t(`programs.${p}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {!checkoutOpen ? (
          <Alert variant="gold" className="max-w-2xl" data-testid="checkout-disabled">
            <TriangleAlert aria-hidden />
            <AlertDescription>{tb('checkoutDisabled')}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {/* Mã khuyến mãi xem trước giá */}
      <form
        className="mx-auto flex max-w-xl flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim().toUpperCase();
          setApplied(c || null);
        }}
        data-testid="promo-form"
      >
        <Label htmlFor="pricing-promo" className="inline-flex items-center gap-1.5">
          <Tag className="size-4" aria-hidden />
          {tb('promo.label')}
        </Label>
        <div className="flex gap-2">
          <Input id="pricing-promo" value={code} onChange={(e) => setCode(e.target.value)} placeholder={tb('promo.placeholder')} autoCapitalize="characters" className="uppercase" data-testid="promo-input" />
          <Button type="submit" variant="outline" disabled={promo.isFetching} data-testid="promo-apply">
            {promo.isFetching ? <Spinner aria-hidden /> : null}
            {tb('promo.apply')}
          </Button>
        </div>
        <div aria-live="polite" className="min-h-5 text-sm" data-testid="promo-status">
          {applied && !signedIn ? (
            <span className="text-muted-foreground">
              {user?.is_guest ? tb('promoReason.guest_account') : tb('promo.loginToApply')}{' '}
              <Link href={`/signup?next=${encodeURIComponent(`/pricing?promo=${applied}`)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                {tb('promo.signupCta')}
              </Link>
            </span>
          ) : promo.isError ? (
            <span className="text-destructive">{te(`codes.${getErrorCode(promo.error)}`)}</span>
          ) : anyValid ? (
            <span className="font-medium text-success" data-testid="promo-valid">
              {tb('promo.applied', { code: anyValid.code, name: anyValid.name ? loc(anyValid.name) : anyValid.code })}
            </span>
          ) : redeemable ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{redeemable.kind === 'trial_days' ? tb('promo.trialCode', { days: redeemable.trial_days ?? redeemable.value ?? 7 }) : tb('promo.creditCode', { credits: redeemable.value ?? 0 })}</span>
              <Button size="sm" variant="gold" disabled={redeem.isPending} onClick={() => redeem.mutate(redeemable.code)} data-testid="promo-redeem">
                {tb('promo.redeem')}
              </Button>
            </span>
          ) : applied && promo.data && shownReason ? (
            <span className="text-destructive" data-testid="promo-invalid" data-reason={shownReason}>
              {tb(`promoReason.${shownReason}`)}
            </span>
          ) : null}
        </div>
      </form>

      {plans.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : groups ? (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Free */}
            {groups.free ? (
              <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6" data-testid="plan-free">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-2xl font-bold">{loc(groups.free.name)}</h2>
                  {currentKind === 'free' ? <Badge variant="secondary">{t('currentPlan')}</Badge> : null}
                </div>
                <p className="text-sm text-muted-foreground">{groups.free.description ? loc(groups.free.description) : t('freeDesc')}</p>
                <p className="text-3xl font-extrabold tabular">{formatVnd(0, locale)}</p>
                <CreditsLine plan={groups.free} />
                <div className="mt-auto">
                  {!user ? (
                    <Link href="/signup" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
                      {t('startFree')}
                    </Link>
                  ) : (
                    <Link href="/toeic/dashboard" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
                      {t('backToApp')}
                    </Link>
                  )}
                </div>
              </section>
            ) : null}

            {/* Pro (theo kỳ) */}
            {pro?.price ? (
              <section className="relative flex flex-col gap-4 rounded-2xl border border-accent bg-navy p-6 text-navy-foreground shadow-lg" data-testid="plan-pro" data-plan={pro.code}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="inline-flex items-center gap-2 text-2xl font-bold text-accent">
                    <Crown className="size-5" aria-hidden />
                    {t('proTitle')}
                  </h2>
                  {currentKind && currentKind === pro.kind ? <Badge variant="gold">{t('currentPlan')}</Badge> : <Badge variant="gold">{t('popular')}</Badge>}
                </div>
                <div role="radiogroup" aria-label={t('periodLabel')} className="grid grid-cols-3 gap-1 rounded-lg bg-white/10 p-1">
                  {periods.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={activePeriod === p}
                      onClick={() => setPeriod(p)}
                      className={cn('rounded-md px-2 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent', activePeriod === p ? 'bg-accent text-accent-foreground' : 'text-white/80 hover:bg-white/10')}
                      data-testid={`period-${p}`}
                    >
                      {t(`period.${p}`)}
                    </button>
                  ))}
                </div>
                <PriceBlock plan={pro} promo={resultFor(pro.price.id)} dark />
                <p className="text-sm text-white/80">{loc(pro.name)}</p>
                <CreditsLine plan={pro} dark />
                <div className="mt-auto space-y-2">
                  <BuyButton href={buyHref(pro.price.id)} disabled={!checkoutOpen} testId={`buy-${pro.code}`} label={signedIn ? t('buy') : t('signupToBuy')} variant="gold" />
                  {trialEligible && !ent.data?.is_pro ? (
                    signedIn ? (
                      <Button variant="outline" className="w-full border-white/30 bg-transparent text-white hover:bg-white/10" disabled={redeem.isPending} onClick={() => redeem.mutate(TRIAL_PROMO_CODE)} data-testid="trial-redeem">
                        <Gift aria-hidden />
                        {t('trialCta')}
                      </Button>
                    ) : (
                      <Link href={`/signup?next=${encodeURIComponent(`/pricing?program=${program}`)}`} className={cn(buttonVariants({ variant: 'outline' }), 'w-full border-white/30 bg-transparent text-white hover:bg-white/10')} data-testid="trial-signup">
                        <Gift aria-hidden />
                        {t('trialCta')}
                      </Link>
                    )
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* Combo mọi chương trình */}
            {groups.combo?.price ? (
              <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6" data-testid="plan-combo" data-plan={groups.combo.code}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="inline-flex items-center gap-2 text-2xl font-bold">
                    <Sparkles className="size-5 text-accent" aria-hidden />
                    {t('comboTitle')}
                  </h2>
                  {currentKind === 'combo' ? <Badge variant="secondary">{t('currentPlan')}</Badge> : null}
                </div>
                <p className="text-sm text-muted-foreground">{t('comboDesc', { programs: groups.combo.programs.map((p) => t(`programs.${p}`)).join(' · ') })}</p>
                <PriceBlock plan={groups.combo} promo={resultFor(groups.combo.price.id)} />
                <p className="text-sm text-muted-foreground">{loc(groups.combo.name)}</p>
                <CreditsLine plan={groups.combo} />
                <div className="mt-auto">
                  <BuyButton href={buyHref(groups.combo.price.id)} disabled={!checkoutOpen} testId={`buy-${groups.combo.code}`} label={signedIn ? t('buy') : t('signupToBuy')} variant="navy" />
                </div>
              </section>
            ) : null}
          </div>

          {/* Gói credit AI */}
          {groups.creditPacks.length ? (
            <section className="space-y-4" aria-labelledby="credit-packs-title">
              <h2 id="credit-packs-title" className="inline-flex items-center gap-2 text-xl font-bold">
                <Coins className="size-5 text-accent" aria-hidden />
                {t('creditPacksTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('creditPacksDesc')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {groups.creditPacks.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4" data-testid={`plan-${p.code}`}>
                    <div>
                      <p className="font-semibold">{loc(p.name)}</p>
                      <p className="text-sm text-muted-foreground">{t('creditsAmount', { credits: p.credits_included })}</p>
                      <PriceInline plan={p} promo={resultFor(p.price!.id)} />
                    </div>
                    <BuyButton href={buyHref(p.price!.id)} disabled={!checkoutOpen} testId={`buy-${p.code}`} label={t('buyShort')} variant="outline" className="w-auto" />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* So sánh quyền lợi – đọc FEATURE_GATES + plans[].features (không ghi số cứng) */}
          <section className="space-y-3" aria-labelledby="compare-title">
            <h2 id="compare-title" className="text-xl font-bold">
              {t('compareTitle')}
            </h2>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[34rem] text-sm" data-testid="compare-table">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      {t('feature')}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      {groups.free ? loc(groups.free.name) : t('freeTitle')}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      {t('proTitle')}
                    </th>
                    {groups.combo ? (
                      <th scope="col" className="px-4 py-3 font-semibold">
                        {t('comboTitle')}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_GATES.map((key) => (
                    <tr key={key} className="border-t border-border" data-testid={`gate-${key}`}>
                      <th scope="row" className="px-4 py-2.5 text-left font-medium">
                        {t(`gates.${key}`)}
                      </th>
                      <GateCell gate={key} plan={groups.free} quotaFrom={currentKind === 'free' ? ent.data : null} />
                      <GateCell gate={key} plan={pro ?? groups.monthly} quotaFrom={currentKind && currentKind !== 'free' ? ent.data : null} />
                      {groups.combo ? <GateCell gate={key} plan={groups.combo} /> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{t('serverNote')}</p>
          </section>
          <p className="text-center text-sm text-muted-foreground">{t('payments')}</p>
        </>
      ) : null}
    </div>
  );
}

function BuyButton({ href, disabled, testId, label, variant, className }: { href: string; disabled: boolean; testId: string; label: string; variant: 'gold' | 'navy' | 'outline'; className?: string }) {
  if (disabled)
    return (
      <Button variant={variant} className={cn('w-full', className)} disabled data-testid={testId}>
        {label}
      </Button>
    );
  return (
    <Link href={href} className={cn(buttonVariants({ variant }), 'w-full', className)} data-testid={testId}>
      {label}
    </Link>
  );
}

function PriceBlock({ plan, promo, dark = false }: { plan: Plan; promo: PromotionValidateResult | null; dark?: boolean }) {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const v = priceView(plan.price!, promo);
  const perMonth = monthlyEquivalent(v.total, plan.duration_days);
  return (
    <div className="space-y-1" data-testid="price-block" data-total={v.total} data-promo={v.promoApplied}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-3xl font-extrabold tabular">{formatVnd(v.total, locale)}</span>
        <span className={cn('text-sm', dark ? 'text-white/70' : 'text-muted-foreground')}>{t(`per.${plan.kind}`)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {v.strike ? <s className={cn('tabular', dark ? 'text-white/60' : 'text-muted-foreground')}>{formatVnd(v.strike, locale)}</s> : null}
        {v.savingsPct ? <Badge variant={v.promoApplied ? 'success' : 'gold'}>{t('save', { pct: v.savingsPct })}</Badge> : null}
        {perMonth ? <span className={cn(dark ? 'text-white/80' : 'text-muted-foreground')}>{t('perMonthEq', { price: formatVnd(perMonth, locale) })}</span> : null}
      </div>
    </div>
  );
}

function PriceInline({ plan, promo }: { plan: Plan; promo: PromotionValidateResult | null }) {
  const locale = useLocale();
  const v = priceView(plan.price!, promo);
  return (
    <p className="text-sm" data-testid="price-block" data-total={v.total}>
      <span className="font-semibold tabular">{formatVnd(v.total, locale)}</span>
      {v.strike ? <s className="ml-2 text-muted-foreground tabular">{formatVnd(v.strike, locale)}</s> : null}
    </p>
  );
}

function CreditsLine({ plan, dark = false }: { plan: Plan; dark?: boolean }) {
  const t = useTranslations('pricing');
  if (!plan.credits_included) return null;
  return (
    <p className={cn('inline-flex items-center gap-1.5 text-sm', dark ? 'text-white/90' : 'text-foreground')}>
      <Coins className={cn('size-4', dark ? 'text-accent' : 'text-accent-foreground')} aria-hidden />
      {t(plan.credits_period === 'monthly' ? 'creditsMonthly' : 'creditsOnce', { credits: plan.credits_included })}
    </p>
  );
}

/** Ô so sánh: có quyền (entitlement null = ai cũng có, hoặc `plans.features[entitlement]`) · có hạn mức (gate tiêu quota) */
function GateCell({ gate, plan, quotaFrom }: { gate: GateKey; plan: Plan | null; quotaFrom?: { quotas: { feature: string; limit: number | null; period: string }[] } | null }) {
  const t = useTranslations('pricing');
  const g = FEATURE_GATES[gate];
  const included = !!plan && (g.entitlement === null || plan.features[g.entitlement] === true);
  const q = g.quota && quotaFrom ? quotaFrom.quotas.find((x) => x.feature === g.quota) : null;
  return (
    <td className="px-4 py-2.5" data-included={included}>
      {included ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Check className="size-4 text-success" aria-label={t('included')} />
          {q && q.limit !== null ? <span className="text-xs text-muted-foreground">{t('quotaOf', { limit: q.limit, period: q.period })}</span> : g.quota && plan?.kind === 'free' ? <span className="text-xs text-muted-foreground">{t('limited')}</span> : null}
        </span>
      ) : (
        <Minus className="size-4 text-muted-foreground" aria-label={t('notIncluded')} />
      )}
    </td>
  );
}
