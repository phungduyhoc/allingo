'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ApiError } from '@allingo/api-client';
import { Button, buttonVariants, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Spinner } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { setStepUpHandler, type MfaRequiredInfo } from '@/lib/mfa-step-up';
import { getMfaStatus, s12Keys, verifyMfa } from '@/lib/s12-api';

/**
 * Hộp thoại step-up MFA (S12): đăng ký làm trình xử lý của `lib/mfa-step-up` – khi request quản trị nhận 403 `mfa_required`,
 * hộp thoại hỏi mã TOTP (hoặc mã khôi phục) → `POST /auth/mfa/verify` → request gốc được gửi lại tự động. Chưa đăng ký TOTP → chỉ
 * dẫn tới Cài đặt → Bảo mật. Huỷ → request gốc nhận 403 như bình thường (màn hình hiện lỗi i18n).
 */
export function MfaStepUpProvider() {
  const [pending, setPending] = React.useState<{ info: MfaRequiredInfo; resolve: (ok: boolean) => void } | null>(null);
  React.useEffect(
    () =>
      setStepUpHandler(
        (info) =>
          new Promise<boolean>((resolve) => {
            setPending({ info, resolve });
          }),
      ),
    [],
  );
  if (!pending) return null;
  const finish = (ok: boolean) => {
    pending.resolve(ok);
    setPending(null);
  };
  return <StepUpDialog info={pending.info} onDone={finish} />;
}

type ErrKey = 'invalid' | 'locked' | 'notEnrolled' | 'generic';

function errKeyOf(err: unknown): ErrKey {
  if (!(err instanceof ApiError)) return 'generic';
  const reason = typeof err.details?.reason === 'string' ? err.details.reason : '';
  if (err.status === 429 || reason === 'mfa_locked') return 'locked';
  if (err.status === 409) return 'notEnrolled';
  if (err.status === 400) return 'invalid';
  return 'generic';
}

function StepUpDialog({ info, onDone }: { info: MfaRequiredInfo; onDone: (ok: boolean) => void }) {
  const t = useTranslations('mfaStepUp');
  const qc = useQueryClient();
  // B7/S144: API gửi `details.enrolled` trong 403 mfa_required → không gọi thêm /me/mfa; chỉ dự phòng khi API cũ không gửi
  const status = useQuery({ queryKey: s12Keys.mfa, queryFn: getMfaStatus, staleTime: 0, enabled: info.enrolled === null });
  const enrolled = info.enrolled ?? status.data?.enrolled ?? null;
  const [recovery, setRecovery] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ErrKey | null>(null);
  const id = React.useId();
  const valid = recovery ? code.trim().length >= 8 : /^\d{6}$/.test(code);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(recovery ? { recovery_code: code.trim() } : { code });
      void qc.invalidateQueries({ queryKey: s12Keys.mfa });
      onDone(true);
    } catch (err) {
      setError(errKeyOf(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onDone(false) : undefined)} data-testid="mfa-step-up">
      <DialogContent>
        <DialogClose aria-label={t('cancel')} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" aria-hidden />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{enrolled === false ? t('notEnrolledDesc') : t('desc')}</DialogDescription>
        </DialogHeader>
        {status.isPending && info.enrolled === null ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : enrolled === false ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => onDone(false)}>
              {t('cancel')}
            </Button>
            <Link href="/settings/security" className={buttonVariants({ variant: 'navy' })} onClick={() => onDone(false)} data-testid="mfa-step-up-enroll">
              {t('enrollCta')}
            </Link>
          </DialogFooter>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-code`}>{recovery ? t('recoveryLabel') : t('codeLabel')}</Label>
              <Input
                id={`${id}-code`}
                value={code}
                onChange={(e) => {
                  setCode(recovery ? e.target.value.slice(0, 32) : e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
                inputMode={recovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                className="h-12 font-mono text-lg tracking-[0.3em]"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-err` : undefined}
                data-testid="mfa-step-up-code"
              />
            </div>
            {error ? (
              <p id={`${id}-err`} role="alert" className="text-sm font-medium text-destructive" data-testid="mfa-step-up-error">
                {t(`errors.${error}`)}
              </p>
            ) : null}
            <button
              type="button"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setRecovery((r) => !r);
                setCode('');
                setError(null);
              }}
            >
              {recovery ? t('useTotp') : t('useRecovery')}
            </button>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onDone(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" variant="navy" disabled={!valid || busy} data-testid="mfa-step-up-submit">
                {busy ? <Spinner aria-hidden /> : null}
                {t('verify')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
