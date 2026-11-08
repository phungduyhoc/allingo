'use client';

import * as React from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription, Button, Input, Label, Spinner } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { postWaitlist, type WaitlistInput } from '@/lib/s10-api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Đăng ký chờ JLPT/HSK/IELTS (S10 – giao diện; `POST /waitlist {email, program, locale, consent_marketing}` → 202 do backend
 * Sprint 12 thêm). API chưa có endpoint (404) → thông báo thân thiện "đang mở đăng ký, quay lại sau" thay vì lỗi.
 * TODO(S12): bỏ trạng thái `unavailable` khi endpoint đã có trong OpenAPI. Email chỉ gửi tới API, không lưu ở trình duyệt.
 */
export function WaitlistForm({ program }: { program: WaitlistInput['program'] }) {
  const t = useTranslations('marketing.waitlist');
  const locale = useLocale();
  const [email, setEmail] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<'idle' | 'sending' | 'accepted' | 'unavailable' | 'failed'>('idle');
  const id = React.useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!EMAIL_RE.test(v) || v.length > 254) {
      setError(t('invalidEmail'));
      return;
    }
    if (!consent) {
      setError(t('consentRequired'));
      return;
    }
    setError(null);
    setState('sending');
    try {
      setState(await postWaitlist({ email: v, program, locale, consent_marketing: consent }));
    } catch {
      setState('failed');
    }
  };

  if (state === 'accepted')
    return (
      <Alert variant="success" className="mt-5" data-testid="waitlist-accepted">
        <CheckCircle2 aria-hidden />
        <AlertDescription>{t('accepted')}</AlertDescription>
      </Alert>
    );
  if (state === 'unavailable')
    return (
      <Alert variant="info" className="mt-5" data-testid="waitlist-unavailable">
        <Info aria-hidden />
        <AlertDescription>
          {t('unavailable')}{' '}
          <Link href="/toeic" className="font-semibold underline underline-offset-4">
            {t('tryToeic')}
          </Link>
        </AlertDescription>
      </Alert>
    );

  return (
    <form onSubmit={submit} noValidate className="mt-5 space-y-4" data-testid="waitlist-form">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-email`}>{t('email')}</Label>
        <Input id={`${id}-email`} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} required />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="waitlist-consent" />
        <span>
          {t('consent')}{' '}
          <Link href="/legal/privacy" className="underline underline-offset-4">
            {t('privacy')}
          </Link>
        </span>
      </label>
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {state === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('failed')}
        </p>
      ) : null}
      <Button type="submit" variant="navy" className="w-full" disabled={state === 'sending'} data-testid="waitlist-submit">
        {state === 'sending' ? <Spinner className="size-4" /> : null}
        {t('submit')}
      </Button>
    </form>
  );
}
