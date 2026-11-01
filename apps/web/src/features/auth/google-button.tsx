'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription, Button, Input, Label } from '@allingo/ui';
import { env } from '@/env';
import { signInWithGoogle } from '@/lib/auth';
import { getErrorCode, isApiError } from '@/lib/errors';
import { useSignInWith } from '@/lib/queries';

/** Kiểu tối thiểu của Google Identity Services (https://accounts.google.com/gsi/client) */
interface GsiCredentialResponse {
  credential: string;
}
interface GsiApi {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (r: GsiCredentialResponse) => void; ux_mode?: 'popup'; auto_select?: boolean; context?: 'signin' | 'signup' }): void;
      renderButton(el: HTMLElement, opts: { theme?: string; size?: string; width?: number; text?: string; shape?: string; locale?: string }): void;
    };
  };
}
declare global {
  interface Window {
    google?: GsiApi;
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGsi(): Promise<GsiApi> {
  if (window.google?.accounts) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? Object.assign(document.createElement('script'), { src: GSI_SRC, async: true, defer: true });
    script.addEventListener('load', () => (window.google ? resolve(window.google) : reject(new Error('gsi unavailable'))));
    script.addEventListener('error', () => reject(new Error('gsi load failed')));
    if (!existing) document.head.appendChild(script);
  });
}

/**
 * Nút "Tiếp tục với Google" (GIS popup → id_token → POST /auth/oauth/google).
 * Ẩn khi chưa cấu hình NEXT_PUBLIC_GOOGLE_CLIENT_ID. Email đã có tài khoản mật khẩu → hỏi mật khẩu để liên kết (409 link_required).
 */
export function GoogleButton({ mode, onSuccess }: { mode: 'login' | 'signup'; onSuccess: () => void }) {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const locale = useLocale();
  const ref = React.useRef<HTMLDivElement>(null);
  const google = useSignInWith(signInWithGoogle);
  const [pendingToken, setPendingToken] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const clientId = env.googleClientId;

  const submit = React.useCallback(
    (idToken: string, linkPassword?: string) => {
      setError(null);
      google.mutate(
        { id_token: idToken, ui_locale: locale, ...(linkPassword ? { link_password: linkPassword } : {}) },
        {
          onSuccess,
          onError: (err) => {
            const details = isApiError(err) ? (err.details as { code?: string } | undefined) : undefined;
            if (isApiError(err) && err.status === 409 && details?.code === 'link_required') {
              setPendingToken(idToken);
              return;
            }
            setError(isApiError(err) && err.status === 401 ? t('googleFailed') : te(`codes.${getErrorCode(err)}`));
          },
        },
      );
    },
    [google, locale, onSuccess, t, te],
  );

  React.useEffect(() => {
    if (!clientId || !ref.current) return;
    let cancelled = false;
    loadGsi()
      .then((gsi) => {
        if (cancelled || !ref.current) return;
        gsi.accounts.id.initialize({ client_id: clientId, ux_mode: 'popup', context: mode === 'signup' ? 'signup' : 'signin', callback: (r) => submit(r.credential) });
        gsi.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 360, text: 'continue_with', shape: 'rectangular', locale });
      })
      .catch(() => !cancelled && setError(t('googleFailed')));
    return () => {
      cancelled = true;
    };
  }, [clientId, locale, mode, submit, t]);

  if (!clientId) return null;

  return (
    <div className="space-y-3" data-testid="google-signin">
      <div ref={ref} className="flex min-h-10 justify-center" aria-label={t('continueWithGoogle')} />
      {pendingToken ? (
        <form
          className="space-y-3 rounded-lg border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(pendingToken, password);
          }}
        >
          <p className="text-sm font-semibold">{t('linkRequiredTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('linkRequiredDesc')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="link-password">{t('password')}</Label>
            <Input id="link-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" variant="navy" className="w-full" disabled={google.isPending || !password}>
            {google.isPending ? t('submitting') : t('linkSubmit')}
          </Button>
        </form>
      ) : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
