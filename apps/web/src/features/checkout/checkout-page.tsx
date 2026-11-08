'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, CreditCard, Lock, QrCode, Smartphone, Tag, TriangleAlert, User as UserIcon, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { FunnelTracker } from '@/features/consent/funnel-tracker';
import type { PayResult, PromotionValidateResult } from '@allingo/schemas';
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Spinner,
} from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { billingKeys, createOrder, getPaymentProviders, getPlans, payOrder, validatePromotion } from '@/lib/billing-api';
import {
  EMPTY_BUYER,
  detailReasonOf,
  findPlanByPrice,
  formatVnd,
  issuePaths,
  promotionReasonOf,
  validateBuyer,
  type BuyerDraft,
  type BuyerErrorCode,
  type BuyerField,
} from '@/lib/billing';
import { getErrorCode, getErrorStatus } from '@/lib/errors';
import { useLocalized } from '@/lib/localized';
import { useMe } from '@/lib/queries';
import { CardSkeleton, ErrorState } from '@/components/states';
import { PageHeader } from '@/components/page-header';
import { checkoutKey, rotateCheckoutKey } from './checkout-session';
import { PaymentQr } from './payment-qr';

/**
 * Checkout `/checkout?price_id=&promo=` (S7/S8): chọn cổng (chỉ cổng server liệt kê; `checkout_enabled=false` → ẩn), mã khuyến mãi
 * (server tính giá, lý do i18n), thông tin hoá đơn (cá nhân/doanh nghiệp, MST kiểm tra như server), đồng ý điều khoản →
 * POST /orders (Idempotency-Key ổn định mỗi phiên) → POST /orders/{id}/pay → chuyển hướng / QR / deeplink.
 * Quyền KHÔNG mở ở đây hay ở trang kết quả – chỉ khi webhook xác nhận (server).
 */
export function CheckoutPage() {
  const t = useTranslations('checkout');
  const tb = useTranslations('billing');
  const te = useTranslations('errors');
  const locale = useLocale();
  const loc = useLocalized();
  const router = useRouter();
  const search = useSearchParams();
  const priceId = search.get('price_id') ?? '';
  const me = useMe();
  const plans = useQuery({ queryKey: billingKeys.plans(), queryFn: () => getPlans(), staleTime: 5 * 60_000 });
  const providers = useQuery({ queryKey: billingKeys.providers, queryFn: getPaymentProviders, staleTime: 30_000 });
  const plan = plans.data ? findPlanByPrice(plans.data, priceId) : null;

  const [promoInput, setPromoInput] = React.useState(() => search.get('promo')?.toUpperCase() ?? '');
  const [promo, setPromo] = React.useState<PromotionValidateResult | null>(null);
  const [buyer, setBuyer] = React.useState<BuyerDraft>(EMPTY_BUYER);
  const [buyerTouched, setBuyerTouched] = React.useState(false);
  const [provider, setProvider] = React.useState<string | null>(null);
  const [accept, setAccept] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<BuyerField | 'terms' | 'provider', string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<PayResult | null>(null);

  const validate = useMutation({
    mutationFn: (code: string) => validatePromotion({ code, price_id: priceId, program: plan?.programs[0] }),
    onSuccess: (r) => setPromo(r),
    onError: (err) => setFormError(te(`codes.${getErrorCode(err)}`)),
  });

  // Mã từ /pricing (?promo=) → kiểm tra ngay khi biết gói
  const autoValidated = React.useRef(false);
  React.useEffect(() => {
    if (autoValidated.current || !plan || !promoInput || !me.data || me.data.is_guest) return;
    autoValidated.current = true;
    validate.mutate(promoInput.trim().toUpperCase());
  }, [plan, promoInput, me.data, validate]);

  const available = providers.data?.providers ?? [];
  const selectedProvider = provider ?? available[0]?.code ?? null;
  const promoValid = !!promo && promo.valid && (promo.applies_to ?? 'order') === 'order';
  const subtotal = plan?.price?.amount ?? 0;
  const discount = promoValid ? promo.discount : 0;
  const total = promoValid ? promo.total : subtotal;
  // Thông tin cá nhân mặc định từ hồ sơ (người dùng sửa được); chỉ để hiển thị, server tự lấy hồ sơ khi trống
  const buyerView: BuyerDraft = buyerTouched ? buyer : { ...buyer, name: buyer.name || me.data?.display_name || '', email: buyer.email || me.data?.email || '' };

  const submit = useMutation({
    mutationFn: async () => {
      const check = validateBuyer(buyerView);
      if (!check.ok) throw Object.assign(new Error('buyer'), { buyerErrors: check.errors });
      const body = { price_id: priceId, ...(promoValid ? { promotion_code: promo.code } : {}), buyer_info: check.value };
      let created;
      try {
        created = await createOrder(body, checkoutKey(priceId));
      } catch (err) {
        // Cùng khoá nhưng body khác (đổi mã / thông tin hoá đơn) hoặc đơn cũ không còn trả được → phiên mới
        if (getErrorStatus(err) === 409) created = await createOrder(body, rotateCheckoutKey(priceId));
        else throw err;
      }
      const order = created.order;
      if (order.status === 'paid') return { kind: 'paid' as const, orderId: order.id };
      if (!order.payable) {
        const fresh = await createOrder(body, rotateCheckoutKey(priceId));
        return { kind: 'pay' as const, orderId: fresh.order.id, pay: await payOrder(fresh.order.id, { provider: selectedProvider!, return_url: returnUrl(locale), locale: locale === 'en' ? 'en' : 'vi' }) };
      }
      return { kind: 'pay' as const, orderId: order.id, pay: await payOrder(order.id, { provider: selectedProvider!, return_url: returnUrl(locale), locale: locale === 'en' ? 'en' : 'vi' }) };
    },
    onSuccess: (r) => {
      if (r.kind === 'paid') {
        router.push(`/checkout/result?order_id=${r.orderId}`);
        return;
      }
      const pay = r.pay;
      if (pay.method === 'redirect' && pay.redirect_url) {
        window.location.assign(pay.redirect_url);
        return;
      }
      if (pay.method === 'deeplink' && pay.deeplink) window.location.href = pay.deeplink;
      setPending(pay);
    },
    onError: (err) => {
      const buyerErrors = (err as { buyerErrors?: Partial<Record<BuyerField, BuyerErrorCode>> }).buyerErrors;
      if (buyerErrors) {
        setErrors(Object.fromEntries(Object.entries(buyerErrors).map(([k, v]) => [k, t(`buyer.errors.${v}`)])));
        return;
      }
      const reason = promotionReasonOf(err);
      if (reason) {
        setPromo((p) => (p ? { ...p, valid: false, reason: reason as PromotionValidateResult['reason'] } : p));
        setFormError(tb(`promoReason.${reason}`));
        return;
      }
      const issues = issuePaths(err);
      const fieldErrs: Record<string, string> = {};
      for (const f of ['tax_code', 'company', 'address', 'email', 'name'] as const) if (issues[`buyer_info.${f}`]) fieldErrs[f] = t(f === 'tax_code' ? 'buyer.errors.invalid_tax_code' : 'buyer.errors.invalid');
      if (Object.keys(fieldErrs).length) {
        setErrors(fieldErrs);
        return;
      }
      const detail = detailReasonOf(err);
      if (detail === 'guest_account') setFormError(t('errors.guest'));
      else if (getErrorCode(err) === 'feature_disabled') setFormError(t('errors.disabled'));
      else if (getErrorCode(err) === 'payment_failed') setFormError(t('errors.paymentFailed'));
      else if (detail === 'order_not_payable') setFormError(t('errors.notPayable'));
      else setFormError(te(`codes.${getErrorCode(err)}`));
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: typeof errors = {};
    const check = validateBuyer(buyerView);
    if (!check.ok) for (const [k, v] of Object.entries(check.errors)) errs[k as BuyerField] = t(`buyer.errors.${v}`);
    if (!accept) errs.terms = t('errors.terms');
    if (!selectedProvider) errs.provider = t('errors.provider');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    submit.mutate();
  };

  const setField = (f: keyof BuyerDraft, v: string) => {
    setBuyerTouched(true);
    setBuyer({ ...buyerView, [f]: v });
    setErrors((x) => ({ ...x, [f]: undefined }));
  };

  if (me.isPending || plans.isPending || providers.isPending) return <CardSkeleton lines={6} />;
  if (plans.isError) return <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />;
  if (!plan?.price) {
    return (
      <div className="space-y-4" data-testid="checkout-page" data-state="not-found">
        <PageHeader title={t('title')} />
        <Alert variant="destructive">
          <AlertDescription>{t('planNotFound')}</AlertDescription>
        </Alert>
        <Link href="/pricing" className={buttonVariants({ variant: 'outline' })}>
          <ArrowLeft aria-hidden />
          {t('backToPricing')}
        </Link>
      </div>
    );
  }

  const nextHere = `/checkout?${search.toString()}`;
  return (
    <div className="space-y-6" data-testid="checkout-page" data-price={priceId}>
      {/* S10: sự kiện phễu checkout_start (chỉ khi đã đồng ý cookie phân tích) */}
      <FunnelTracker event="checkout_start" properties={plan ? { plan_kind: plan.kind } : undefined} />
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Link href="/pricing" className={buttonVariants({ variant: 'ghost' })}>
            <ArrowLeft aria-hidden />
            {t('backToPricing')}
          </Link>
        }
      />
      {me.data?.is_guest ? (
        <Alert variant="gold" data-testid="checkout-guest">
          <UserIcon aria-hidden />
          <AlertDescription>
            <p>{t('errors.guest')}</p>
            <Link href={`/signup?next=${encodeURIComponent(nextHere)}`} className={cn(buttonVariants({ variant: 'navy', size: 'sm' }), 'mt-2')}>
              {t('signupFirst')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {providers.data && !providers.data.checkout_enabled ? (
        <Alert variant="gold" data-testid="checkout-disabled">
          <TriangleAlert aria-hidden />
          <AlertDescription>{tb('checkoutDisabled')}</AlertDescription>
        </Alert>
      ) : null}

      <form className="grid gap-6 lg:grid-cols-[1fr_22rem]" onSubmit={onSubmit} noValidate>
        <div className="space-y-6">
          {/* Cổng thanh toán */}
          <Card>
            <CardHeader>
              <CardTitle>{t('providerTitle')}</CardTitle>
              <CardDescription>{t('providerDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {available.length === 0 || !providers.data?.checkout_enabled ? (
                <p className="text-sm text-muted-foreground">{t('noProviders')}</p>
              ) : (
                <div role="radiogroup" aria-label={t('providerTitle')} className="grid gap-2 sm:grid-cols-2">
                  {available.map((p) => {
                    const Icon = p.methods.includes('qr') ? QrCode : p.methods.includes('deeplink') ? Smartphone : CreditCard;
                    const checked = selectedProvider === p.code;
                    return (
                      <button
                        key={p.code}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={() => setProvider(p.code)}
                        className={cn('flex items-center gap-3 rounded-lg border px-3 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}
                        data-testid={`provider-${p.code}`}
                      >
                        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{tb(`providers.${p.code}`)}</span>
                          <span className="block text-xs text-muted-foreground">{p.methods.map((m) => tb(`methods.${m}`)).join(' · ')}</span>
                        </span>
                        {p.sandbox ? <Badge variant="muted">{tb('sandbox')}</Badge> : null}
                      </button>
                    );
                  })}
                </div>
              )}
              {errors.provider ? <p className="mt-2 text-xs text-destructive">{errors.provider}</p> : null}
            </CardContent>
          </Card>

          {/* Thông tin hoá đơn điện tử */}
          <Card>
            <CardHeader>
              <CardTitle>{t('buyer.title')}</CardTitle>
              <CardDescription>{t('buyer.desc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div role="radiogroup" aria-label={t('buyer.typeLabel')} className="grid grid-cols-2 gap-2">
                {(['personal', 'business'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={buyerView.type === type}
                    onClick={() => setField('type', type)}
                    className={cn('flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', buyerView.type === type ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}
                    data-testid={`buyer-type-${type}`}
                  >
                    {type === 'personal' ? <UserIcon className="size-4" aria-hidden /> : <Building2 className="size-4" aria-hidden />}
                    {t(`buyer.${type}`)}
                  </button>
                ))}
              </div>
              {buyerView.type === 'business' ? (
                <>
                  <Field id="buyer-company" label={t('buyer.company')} value={buyerView.company} onChange={(v) => setField('company', v)} error={errors.company} autoComplete="organization" required />
                  <Field
                    id="buyer-tax-code"
                    label={t('buyer.taxCode')}
                    hint={t('buyer.taxCodeHint')}
                    value={buyerView.tax_code}
                    onChange={(v) => setField('tax_code', v)}
                    onBlur={() => {
                      if (!buyerView.tax_code.trim()) return;
                      const r = validateBuyer({ ...buyerView, company: buyerView.company || 'x', address: buyerView.address || 'x' });
                      if (!r.ok && r.errors.tax_code) setErrors((x) => ({ ...x, tax_code: t(`buyer.errors.${r.errors.tax_code}`) }));
                    }}
                    error={errors.tax_code}
                    inputMode="numeric"
                    required
                  />
                  <Field id="buyer-address" label={t('buyer.address')} value={buyerView.address} onChange={(v) => setField('address', v)} error={errors.address} autoComplete="street-address" required />
                </>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="buyer-name" label={buyerView.type === 'business' ? t('buyer.contactName') : t('buyer.name')} value={buyerView.name} onChange={(v) => setField('name', v)} error={errors.name} autoComplete="name" />
                <Field id="buyer-email" label={t('buyer.email')} hint={t('buyer.emailHint')} value={buyerView.email} onChange={(v) => setField('email', v)} error={errors.email} type="email" autoComplete="email" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tóm tắt đơn */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card data-testid="checkout-summary">
            <CardHeader>
              <CardTitle>{t('summaryTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-semibold" data-testid="summary-plan">
                  {loc(plan.name)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tb(`kind.${plan.kind}`)}
                  {plan.credits_included ? ` · ${t('credits', { credits: plan.credits_included })}` : ''}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="checkout-promo" className="inline-flex items-center gap-1.5">
                  <Tag className="size-4" aria-hidden />
                  {tb('promo.label')}
                </Label>
                {promoValid ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm" data-testid="checkout-promo-applied">
                    <span>
                      <span className="font-semibold">{promo.code}</span>
                      {promo.name ? ` · ${loc(promo.name)}` : ''}
                    </span>
                    <Button variant="ghost" size="icon-sm" aria-label={t('removePromo')} onClick={() => setPromo(null)}>
                      <X aria-hidden />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input id="checkout-promo" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} className="uppercase" placeholder={tb('promo.placeholder')} data-testid="checkout-promo-input" />
                    <Button variant="outline" disabled={!promoInput.trim() || validate.isPending || !!me.data?.is_guest} onClick={() => validate.mutate(promoInput.trim().toUpperCase())} data-testid="checkout-promo-apply">
                      {validate.isPending ? <Spinner aria-hidden /> : null}
                      {tb('promo.apply')}
                    </Button>
                  </div>
                )}
                {promo && !promoValid ? (
                  <p className="text-xs text-destructive" data-testid="checkout-promo-error" data-reason={promo.reason ?? ''} aria-live="polite">
                    {promo.reason ? tb(`promoReason.${promo.reason}`) : tb('promoReason.not_found')}
                  </p>
                ) : null}
              </div>
              <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('subtotal')}</dt>
                  <dd className="tabular">{formatVnd(subtotal, locale)}</dd>
                </div>
                {discount ? (
                  <div className="flex justify-between text-success" data-testid="summary-discount">
                    <dt>{t('discount')}</dt>
                    <dd className="tabular">−{formatVnd(discount, locale)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
                  <dt>{t('total')}</dt>
                  <dd className="tabular" data-testid="summary-total" data-total={total}>
                    {formatVnd(total, locale)}
                  </dd>
                </div>
              </dl>
              <label className="flex items-start gap-2 text-sm" htmlFor="checkout-terms">
                <input
                  id="checkout-terms"
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--color-primary)]"
                  checked={accept}
                  onChange={(e) => {
                    setAccept(e.target.checked);
                    setErrors((x) => ({ ...x, terms: undefined }));
                  }}
                  aria-invalid={errors.terms ? true : undefined}
                  data-testid="checkout-terms"
                />
                <span>
                  {t('termsPrefix')}{' '}
                  <Link href="/terms" className="font-semibold text-primary underline-offset-4 hover:underline" target="_blank">
                    {t('terms')}
                  </Link>
                  {t('termsSuffix')}
                </span>
              </label>
              {errors.terms ? <p className="text-xs text-destructive">{errors.terms}</p> : null}
              {formError ? (
                <Alert variant="destructive" data-testid="checkout-error">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="submit"
                variant="gold"
                size="lg"
                className="w-full"
                disabled={submit.isPending || !!me.data?.is_guest || !providers.data?.checkout_enabled || available.length === 0}
                data-testid="checkout-submit"
              >
                {submit.isPending ? <Spinner aria-hidden /> : <Lock aria-hidden />}
                {t('pay', { total: formatVnd(total, locale) })}
              </Button>
              <p className="text-xs text-muted-foreground">{t('secureNote')}</p>
            </CardContent>
          </Card>
        </div>
      </form>

      <Dialog open={!!pending} onOpenChange={(o) => (o ? null : setPending(null))}>
        <DialogContent>
          <DialogClose aria-label={t('close')} />
          <DialogHeader>
            <DialogTitle>{pending?.method === 'qr' ? t('qrTitle') : t('deeplinkTitle')}</DialogTitle>
            <DialogDescription>{pending?.method === 'qr' ? t('qrDesc') : t('deeplinkDesc')}</DialogDescription>
          </DialogHeader>
          {pending ? <PaymentQr pay={pending} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function returnUrl(locale: string): string {
  return `${window.location.origin}/${locale}/checkout/result`;
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  onBlur,
  error,
  required,
  ...rest
}: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; onBlur?: () => void; error?: string; required?: boolean } & Omit<React.ComponentProps<'input'>, 'onChange' | 'value' | 'id' | 'onBlur'>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} data-testid={id} {...rest} />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive" data-testid={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
