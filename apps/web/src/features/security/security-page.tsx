'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Download, KeyRound, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@allingo/api-client';
import { Alert, AlertDescription, AlertTitle, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Spinner } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { copyText, downloadText, groupSecret } from '@/lib/clipboard';
import { confirmTotp, enrollTotp, getMfaStatus, regenerateRecoveryCodes, s12Keys, verifyMfa, type MfaEnrollResult } from '@/lib/s12-api';
import { isAdmin } from '@/features/admin/is-admin';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';

/**
 * Cài đặt → Bảo mật `/settings/security` (S12): MFA TOTP (RFC 6238, SHA1, 6 số, 30 s) cho tài khoản quản trị – trạng thái
 * `GET /me/mfa`, đăng ký (`enroll` → khoá base32 + liên kết otpauth; API không trả ảnh QR nên hiển thị khoá + nút sao chép, KHÔNG
 * thêm thư viện QR), xác nhận mã đầu tiên → 10 mã khôi phục hiển thị MỘT lần (sao chép/tải .txt), xác minh phiên (step-up),
 * tạo lại mã khôi phục (cần mã TOTP hiện tại). Mã khôi phục chỉ nằm trong state của trang – không lưu trình duyệt.
 */
export function SecurityPage() {
  const t = useTranslations('security');
  const me = useMe();
  const status = useQuery({ queryKey: s12Keys.mfa, queryFn: getMfaStatus });
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const admin = isAdmin(me.data);

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="security-page">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="size-5" aria-hidden />
              {t('mfaTitle')}
              {status.data?.required ? <Badge variant="gold">{t('required')}</Badge> : null}
            </CardTitle>
            <CardDescription>{t('mfaDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {status.isPending || me.isPending ? (
              <CardSkeleton lines={3} className="border-0 p-0" />
            ) : status.isError ? (
              <ErrorState error={status.error} onRetry={() => void status.refetch()} />
            ) : (
              <>
                <dl className="grid gap-3 sm:grid-cols-3" data-testid="mfa-status" data-enrolled={status.data.enrolled} data-verified={status.data.session_verified}>
                  <Fact label={t('factEnrolled')} value={status.data.enrolled ? t('yes') : status.data.pending_enrollment ? t('pending') : t('no')} ok={status.data.enrolled} />
                  <Fact label={t('factSession')} value={status.data.session_verified ? t('verified') : t('notVerified')} ok={status.data.session_verified} />
                  <Fact label={t('factRecovery')} value={status.data.enrolled ? String(status.data.recovery_codes_remaining) : '—'} ok={status.data.recovery_codes_remaining > 2} />
                </dl>
                {status.data.enrolled ? (
                  <EnrolledActions sessionVerified={status.data.session_verified} lowCodes={status.data.recovery_codes_remaining <= 2} onCodes={setCodes} />
                ) : admin ? (
                  <Enroll pending={status.data.pending_enrollment} onCodes={setCodes} />
                ) : (
                  <Alert variant="info" data-testid="mfa-not-applicable">
                    <AlertDescription>{t('notApplicable')}</AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('otherTitle')}</CardTitle>
          <CardDescription>{t('otherDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/support" className={buttonVariants({ variant: 'outline' })}>
            {t('contactSupport')}
          </Link>
          <Link href="/legal/privacy" className={buttonVariants({ variant: 'outline' })}>
            {t('privacyLink')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={ok ? 'font-semibold text-success' : 'font-semibold'}>{value}</dd>
    </div>
  );
}

function codeError(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError) {
    const reason = typeof err.details?.reason === 'string' ? err.details.reason : '';
    if (err.status === 429 || reason === 'mfa_locked') return t('errors.locked');
    if (reason === 'mfa_already_enrolled') return t('errors.alreadyEnrolled');
    if (err.status === 409) return t('errors.notEnrolled');
    if (err.status === 400) return t('errors.invalid');
    if (err.status === 403) return t('errors.forbidden');
  }
  return t('errors.generic');
}

/** Ô 6 số dùng chung (TOTP) */
function CodeField({ id, value, onChange, label, error, testId }: { id: string; value: string; onChange: (v: string) => void; label: string; error?: string | null; testId: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        className="h-11 w-44 font-mono text-lg tracking-[0.3em]"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        data-testid={testId}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Enroll({ pending, onCodes }: { pending: boolean; onCodes: (codes: string[]) => void }) {
  const t = useTranslations('security');
  const qc = useQueryClient();
  const id = React.useId();
  const [secret, setSecret] = React.useState<MfaEnrollResult | null>(null);
  const [code, setCode] = React.useState('');
  const enroll = useMutation({ mutationFn: enrollTotp, onSuccess: (r) => setSecret(r) });
  const confirm = useMutation({
    mutationFn: (c: string) => confirmTotp(c),
    meta: { inlineErrors: true },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: s12Keys.mfa });
      onCodes(r.recovery_codes);
    },
  });
  if (!secret) {
    return (
      <div className="space-y-3">
        {enroll.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {codeError(enroll.error, t)}
          </p>
        ) : null}
        <Button variant="navy" onClick={() => enroll.mutate()} disabled={enroll.isPending} data-testid="mfa-enroll">
          {enroll.isPending ? <Spinner aria-hidden /> : <KeyRound aria-hidden />}
          {pending ? t('continueEnroll') : t('enroll')}
        </Button>
      </div>
    );
  }
  const copy = async (text: string) => {
    if (await copyText(text)) toast.success(t('copied'));
    else toast.error(t('copyFailed'));
  };
  return (
    <div className="space-y-5" data-testid="mfa-enroll-panel">
      <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed">
        <li>
          <span className="font-semibold">{t('stepApp')}</span>
          <span className="block text-muted-foreground">{t('stepAppDesc')}</span>
        </li>
        <li className="space-y-2">
          <span className="font-semibold">{t('stepKey')}</span>
          <span className="block text-muted-foreground">{t('stepKeyDesc', { digits: secret.digits, period: secret.period })}</span>
          <code className="block rounded-lg border border-border bg-muted px-3 py-2 font-mono text-base break-all select-all" data-testid="mfa-secret" data-secret={secret.secret}>
            {groupSecret(secret.secret)}
          </code>
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void copy(secret.secret)} data-testid="mfa-copy-secret">
              <Copy aria-hidden />
              {t('copySecret')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copy(secret.otpauth_url)}>
              <Copy aria-hidden />
              {t('copyLink')}
            </Button>
            <a href={secret.otpauth_url} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <Smartphone aria-hidden />
              {t('openApp')}
            </a>
          </span>
        </li>
        <li>
          <span className="font-semibold">{t('stepCode')}</span>
          <form
            className="mt-2 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{6}$/.test(code)) confirm.mutate(code);
            }}
          >
            <CodeField id={`${id}-confirm`} value={code} onChange={setCode} label={t('codeLabel')} error={confirm.isError ? codeError(confirm.error, t) : null} testId="mfa-confirm-code" />
            <Button type="submit" variant="navy" disabled={!/^\d{6}$/.test(code) || confirm.isPending} data-testid="mfa-confirm">
              {confirm.isPending ? <Spinner aria-hidden /> : null}
              {t('confirm')}
            </Button>
          </form>
        </li>
      </ol>
    </div>
  );
}

function EnrolledActions({ sessionVerified, lowCodes, onCodes }: { sessionVerified: boolean; lowCodes: boolean; onCodes: (codes: string[]) => void }) {
  const t = useTranslations('security');
  const qc = useQueryClient();
  const id = React.useId();
  const [verifyCode, setVerifyCode] = React.useState('');
  const [regenCode, setRegenCode] = React.useState('');
  const verify = useMutation({
    mutationFn: (c: string) => verifyMfa({ code: c }),
    meta: { inlineErrors: true },
    onSuccess: () => {
      setVerifyCode('');
      toast.success(t('verifiedToast'));
      void qc.invalidateQueries({ queryKey: s12Keys.mfa });
    },
  });
  const regen = useMutation({
    mutationFn: (c: string) => regenerateRecoveryCodes(c),
    meta: { inlineErrors: true },
    onSuccess: (codes) => {
      void qc.invalidateQueries({ queryKey: s12Keys.mfa });
      onCodes(codes);
    },
  });
  return (
    <div className="space-y-6">
      {lowCodes ? (
        <Alert variant="gold">
          <ShieldAlert aria-hidden />
          <AlertDescription>{t('lowCodes')}</AlertDescription>
        </Alert>
      ) : null}
      {!sessionVerified ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(verifyCode)) verify.mutate(verifyCode);
          }}
        >
          <CodeField id={`${id}-verify`} value={verifyCode} onChange={setVerifyCode} label={t('verifyLabel')} error={verify.isError ? codeError(verify.error, t) : null} testId="mfa-verify-code" />
          <Button type="submit" variant="navy" disabled={!/^\d{6}$/.test(verifyCode) || verify.isPending} data-testid="mfa-verify">
            {verify.isPending ? <Spinner aria-hidden /> : null}
            {t('verifySession')}
          </Button>
        </form>
      ) : null}
      <div className="space-y-2 border-t border-border pt-5">
        <h3 className="font-semibold">{t('regenTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('regenDesc')}</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(regenCode)) regen.mutate(regenCode);
          }}
        >
          <CodeField id={`${id}-regen`} value={regenCode} onChange={setRegenCode} label={t('codeLabel')} error={regen.isError ? codeError(regen.error, t) : null} testId="mfa-regen-code" />
          <Button type="submit" variant="outline" disabled={!/^\d{6}$/.test(regenCode) || regen.isPending} data-testid="mfa-regen">
            {regen.isPending ? <Spinner aria-hidden /> : null}
            {t('regen')}
          </Button>
        </form>
      </div>
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useTranslations('security');
  const [saved, setSaved] = React.useState(false);
  const text = codes.join('\n');
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => headingRef.current?.focus(), []);
  return (
    <Card className="border-accent" data-testid="mfa-recovery-codes">
      <CardHeader>
        <CardTitle>
          <span ref={headingRef} tabIndex={-1} className="outline-none">
            {t('codesTitle')}
          </span>
        </CardTitle>
        <CardDescription>{t('codesDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="gold">
          <AlertTitle>{t('codesOnce')}</AlertTitle>
          <AlertDescription>{t('codesOnceDesc')}</AlertDescription>
        </Alert>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5" aria-label={t('codesTitle')}>
          {codes.map((c) => (
            <li key={c} className="rounded border border-border bg-muted px-2 py-1.5 text-center select-all" data-testid="mfa-recovery-code">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (await copyText(text)) toast.success(t('copied'));
              else toast.error(t('copyFailed'));
            }}
          >
            <Copy aria-hidden />
            {t('copyAll')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadText('allingo-recovery-codes.txt', `${t('codesFileHeader')}\n\n${text}\n`)} data-testid="mfa-download-codes">
            <Download aria-hidden />
            {t('download')}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-navy)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="mfa-codes-saved" />
          {t('codesSaved')}
        </label>
        <Button variant="navy" disabled={!saved} onClick={onDone} data-testid="mfa-codes-done">
          {t('codesDone')}
        </Button>
      </CardContent>
    </Card>
  );
}
