'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import { toast } from 'sonner';
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { useLogin, useRegister } from '@/lib/queries';
import { getErrorCode, getFieldErrors, isApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/use-error-message';
import { PASSWORD_MIN_LENGTH, passwordPolicyIssue } from '@/lib/password-policy';
import { getGuestToken } from '@/lib/auth';
import { useClientValue } from '@/lib/use-mounted';
import { env } from '@/env';
import { safeNextPath } from '@/lib/billing';
import { GoogleButton } from './google-button';
import { OtpLoginForm } from './otp-login-form';
import { FunnelTracker } from '@/features/consent/funnel-tracker';

type Mode = 'login' | 'signup';


export function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations('auth');
  const errorMessage = useErrorMessage();
  const locale = useLocale();
  const router = useRouter();
  const login = useLogin();
  const signup = useRegister();
  const pending = login.isPending || signup.isPending;

  const [values, setValues] = React.useState({ email: '', password: '', display_name: '' });
  const [acceptTerms, setAcceptTerms] = React.useState(false);
  const [marketing, setMarketing] = React.useState(false);
  const [useOtp, setUseOtp] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const hasGuest = useClientValue(() => !!getGuestToken(), false);

  const schema = React.useMemo(
    () =>
      z.object({
        email: z.email({ message: t('validation.email') }),
        // S12 (API): đăng ký cần ≥ PASSWORD_MIN_LENGTH (12) ký tự + không phổ biến/lộ – server kiểm tra lại (issues[].code)
        password: mode === 'signup' ? z.string().min(PASSWORD_MIN_LENGTH, { message: t('validation.passwordMin', { min: PASSWORD_MIN_LENGTH }) }) : z.string().min(1, { message: t('validation.password') }),
        display_name: mode === 'signup' ? z.string().trim().min(1, { message: t('validation.displayName') }).max(80, { message: t('validation.displayName') }) : z.string().optional(),
      }),
    [mode, t],
  );

  // `?next=` (vd. từ /pricing → /checkout) – chỉ nhận đường dẫn nội bộ; đọc lúc đăng nhập xong (không cần useSearchParams/Suspense)
  const afterSignIn = React.useCallback(() => {
    toast.success(mode === 'login' ? t('submitLogin') : t('submitSignup'));
    const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    router.push(next ?? '/toeic/dashboard');
  }, [mode, router, t]);
  // Giữ `next`/`ref`/UTM khi chuyển qua lại Đăng nhập ↔ Đăng ký
  const carriedQuery = useClientValue(() => {
    const src = new URLSearchParams(window.location.search);
    const keep = new URLSearchParams();
    for (const [k, v] of src) if (k === 'next' || k === 'ref' || k.startsWith('utm_')) keep.set(k, v);
    const q = keep.toString();
    return q ? `?${q}` : '';
  }, '');

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse(values);
    const errs: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        errs[key] ??= issue.message;
      }
    }
    if (mode === 'signup' && !acceptTerms) errs.accept_terms = t('validation.acceptTerms');
    if (!parsed.success || Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    const onError = (err: unknown) => {
      const code = getErrorCode(err);
      const fields = getFieldErrors(err);
      // S12: chính sách mật khẩu của API → thông điệp i18n theo mã (password_too_short | password_breached | password_weak)
      const policy = passwordPolicyIssue(err);
      if (policy) {
        setFieldErrors({ ...fields, password: t(`passwordPolicy.${policy.code}`, { min: policy.minLength }) });
        return;
      }
      if (Object.keys(fields).length) setFieldErrors(fields);
      if (mode === 'login' && isApiError(err) && err.status === 401) setFormError(t('errors.invalidCredentials'));
      else if (mode === 'signup' && code === 'conflict') setFormError(t('errors.emailTaken'));
      // S11: 429 khoá đăng nhập (`login_locked`) / giới hạn tốc độ → thông điệp riêng kèm thời gian chờ
      else setFormError(errorMessage(err));
    };
    const onSuccess = () => afterSignIn();
    if (mode === 'login') login.mutate({ email: parsed.data.email, password: parsed.data.password }, { onSuccess, onError });
    else signup.mutate({ email: parsed.data.email, password: parsed.data.password, display_name: parsed.data.display_name ?? '', ui_locale: locale, accept_terms: true, marketing_opt_in: marketing }, { onSuccess, onError });
  };

  const field = (name: keyof typeof values) => ({
    id: name,
    name,
    value: values[name],
    'aria-invalid': fieldErrors[name] ? true : undefined,
    'aria-describedby': fieldErrors[name] ? `${name}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight">{mode === 'login' ? t('loginTitle') : t('signupTitle')}</CardTitle>
        <CardDescription>{mode === 'login' ? t('loginSubtitle') : t('signupSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* S10: sự kiện phễu signup_start khi mở form đăng ký (chỉ khi đã đồng ý cookie phân tích) */}
        {mode === 'signup' ? <FunnelTracker event="signup_start" /> : null}
        <GoogleButton mode={mode} onSuccess={afterSignIn} />
        {env.googleClientId ? (
          <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            {t('or')}
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : null}
        {mode === 'login' && useOtp ? (
          <OtpLoginForm onSuccess={afterSignIn} />
        ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid={`${mode}-form`}>
          {mode === 'signup' ? (
            <div className="space-y-1.5">
              <Label htmlFor="display_name">{t('displayName')}</Label>
              <Input {...field('display_name')} autoComplete="name" />
              {fieldErrors.display_name ? (
                <p id="display_name-error" className="text-xs text-destructive">
                  {fieldErrors.display_name}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('email')}</Label>
            <Input {...field('email')} type="email" autoComplete="email" inputMode="email" />
            {fieldErrors.email ? (
              <p id="email-error" className="text-xs text-destructive">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t('password')}</Label>
            <Input {...field('password')} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {fieldErrors.password ? (
              <p id="password-error" className="text-xs text-destructive">
                {fieldErrors.password}
              </p>
            ) : mode === 'signup' ? (
              <p className="text-xs text-muted-foreground">{t('passwordPolicyHint', { min: PASSWORD_MIN_LENGTH })}</p>
            ) : null}
          </div>
          {mode === 'signup' ? (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm" htmlFor="accept_terms">
                <input
                  id="accept_terms"
                  data-testid="accept-terms"
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--color-primary)]"
                  checked={acceptTerms}
                  aria-invalid={fieldErrors.accept_terms ? true : undefined}
                  aria-describedby={fieldErrors.accept_terms ? 'accept_terms-error' : undefined}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                />
                <span>
                  {t('acceptTermsPrefix')}{' '}
                  <Link href="/terms" className="font-semibold text-primary underline-offset-4 hover:underline">
                    {t('terms')}
                  </Link>{' '}
                  {t('and')}{' '}
                  <Link href="/privacy" className="font-semibold text-primary underline-offset-4 hover:underline">
                    {t('privacy')}
                  </Link>
                </span>
              </label>
              {fieldErrors.accept_terms ? (
                <p id="accept_terms-error" className="text-xs text-destructive">
                  {fieldErrors.accept_terms}
                </p>
              ) : null}
              <label className="flex items-start gap-2 text-sm text-muted-foreground" htmlFor="marketing_opt_in">
                <input id="marketing_opt_in" type="checkbox" className="mt-0.5 size-4" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                <span>{t('marketingOptIn')}</span>
              </label>
            </div>
          ) : null}
          {hasGuest ? (
            <Alert variant="gold">
              <AlertDescription>{t('guestMergeNote')}</AlertDescription>
            </Alert>
          ) : null}
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" variant="navy" size="lg" className="w-full" disabled={pending}>
            {pending ? t('submitting') : mode === 'login' ? t('submitLogin') : t('submitSignup')}
          </Button>
        </form>
        )}
        {mode === 'login' ? (
          <button type="button" data-testid="toggle-otp" className="w-full text-center text-sm font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setUseOtp((v) => !v)}>
            {useOtp ? t('usePassword') : t('loginWithCode')}
          </button>
        ) : null}
        <p className="text-center text-sm text-muted-foreground">
          {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
          <Link href={`${mode === 'login' ? '/signup' : '/login'}${carriedQuery}`} className="font-semibold text-primary underline-offset-4 hover:underline">
            {mode === 'login' ? t('submitSignup') : t('submitLogin')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
