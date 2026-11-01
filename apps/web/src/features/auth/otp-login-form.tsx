'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import { Alert, AlertDescription, Button, Input, Label } from '@allingo/ui';
import { requestEmailOtp, verifyEmailOtp } from '@/lib/auth';
import { getErrorCode, isApiError } from '@/lib/errors';
import { useSignInWith } from '@/lib/queries';

/**
 * Đăng nhập bằng mã 6 số gửi qua email (POST /auth/otp/request → /auth/otp/verify).
 * Tài khoản chưa có sẽ được tạo; tiến độ khách được ghép (guest_token).
 */
export function OtpLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const locale = useLocale();
  const verify = useSignInWith(verifyEmailOtp);
  const [step, setStep] = React.useState<'email' | 'code'>('email');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [info, setInfo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const explain = (err: unknown) => {
    if (isApiError(err) && err.status === 429) {
      const sec = Number((err.details as { retry_after_sec?: number } | undefined)?.retry_after_sec ?? 1800);
      return t('otpLocked', { minutes: Math.max(1, Math.ceil(sec / 60)) });
    }
    if (isApiError(err) && err.status === 401) {
      const d = err.details as { reason?: string; attempts_left?: number } | undefined;
      if (d?.reason === 'otp_invalid') return t('otpInvalid', { left: d.attempts_left ?? 0 });
      return t('otpExpired');
    }
    return te(`codes.${getErrorCode(err)}`);
  };

  const send = async () => {
    setError(null);
    const parsed = z.email().safeParse(email.trim());
    if (!parsed.success) {
      setError(t('validation.email'));
      return;
    }
    setSending(true);
    try {
      const r = await requestEmailOtp(parsed.data);
      setStep('code');
      setCooldown(r.retry_after);
      setInfo(t('otpSent', { email: parsed.data, minutes: Math.round(r.expires_in / 60) }));
    } catch (err) {
      setError(explain(err));
    } finally {
      setSending(false);
    }
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step === 'email') {
      void send();
      return;
    }
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t('validation.otp'));
      return;
    }
    verify.mutate({ email: email.trim(), otp: code, ui_locale: locale }, { onSuccess, onError: (err) => setError(explain(err)) });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="otp-form">
      <div className="space-y-1.5">
        <Label htmlFor="otp-email">{t('otpEmailLabel')}</Label>
        <Input id="otp-email" type="email" autoComplete="email" inputMode="email" value={email} disabled={step === 'code'} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {step === 'code' ? (
        <div className="space-y-1.5">
          <Label htmlFor="otp-code">{t('otpCodeLabel')}</Label>
          <Input
            id="otp-code"
            data-testid="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="text-center font-mono text-lg tracking-[0.5em]"
          />
        </div>
      ) : null}
      {info && step === 'code' ? (
        <Alert variant="gold" role="status" data-testid="otp-info">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" role="alert" data-testid="otp-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" variant="navy" size="lg" className="w-full" disabled={sending || verify.isPending}>
        {sending || verify.isPending ? t('submitting') : step === 'email' ? t('otpSend') : t('otpVerify')}
      </Button>
      {step === 'code' ? (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setStep('email');
              setCode('');
              setInfo(null);
            }}
          >
            {t('otpChangeEmail')}
          </button>
          <button type="button" className="font-semibold text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline" disabled={cooldown > 0 || sending} onClick={() => void send()}>
            {cooldown > 0 ? t('otpResendIn', { seconds: cooldown }) : t('otpResend')}
          </button>
        </div>
      ) : null}
    </form>
  );
}
