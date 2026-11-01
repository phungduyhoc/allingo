'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import { toast } from 'sonner';
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { useLogin, useRegister } from '@/lib/queries';
import { getErrorCode, getFieldErrors, isApiError } from '@/lib/errors';
import { getGuestToken } from '@/lib/auth';
import { useClientValue } from '@/lib/use-mounted';

type Mode = 'login' | 'signup';

export function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const login = useLogin();
  const signup = useRegister();
  const pending = login.isPending || signup.isPending;

  const [values, setValues] = React.useState({ email: '', password: '', display_name: '' });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const hasGuest = useClientValue(() => !!getGuestToken(), false);

  const schema = React.useMemo(
    () =>
      z.object({
        email: z.email({ message: t('validation.email') }),
        password: z.string().min(mode === 'signup' ? 8 : 1, { message: t('validation.password') }),
        display_name: mode === 'signup' ? z.string().trim().min(1, { message: t('validation.displayName') }).max(80, { message: t('validation.displayName') }) : z.string().optional(),
      }),
    [mode, t],
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        errs[key] ??= issue.message;
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    const onError = (err: unknown) => {
      const code = getErrorCode(err);
      const fields = getFieldErrors(err);
      if (Object.keys(fields).length) setFieldErrors(fields);
      if (mode === 'login' && isApiError(err) && err.status === 401) setFormError(t('errors.invalidCredentials'));
      else if (mode === 'signup' && code === 'conflict') setFormError(t('errors.emailTaken'));
      else setFormError(te(`codes.${code}`));
    };
    const onSuccess = () => {
      toast.success(mode === 'login' ? t('submitLogin') : t('submitSignup'));
      router.push('/toeic/dashboard');
    };
    if (mode === 'login') login.mutate({ email: parsed.data.email, password: parsed.data.password }, { onSuccess, onError });
    else signup.mutate({ email: parsed.data.email, password: parsed.data.password, display_name: parsed.data.display_name ?? '', ui_locale: locale }, { onSuccess, onError });
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
      <CardContent>
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
              <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
            ) : null}
          </div>
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
        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
          <Link href={mode === 'login' ? '/signup' : '/login'} className="font-semibold text-primary underline-offset-4 hover:underline">
            {mode === 'login' ? t('submitSignup') : t('submitLogin')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
