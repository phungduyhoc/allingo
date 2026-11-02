'use client';

import * as React from 'react';
import { Download, Share, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@allingo/ui';
import { LogoMark } from '@/components/logo';
import {
  countVisit,
  installStore,
  isIosSafari,
  isSnoozed,
  isStandalone,
  shouldShowInstall,
  snoozeInstall,
} from './install-state';

/**
 * Gợi ý cài PWA sau 2 lần truy cập: Chrome/Edge/Android → nút "Cài đặt" (beforeinstallprompt.prompt()); iOS Safari →
 * hướng dẫn Chia sẻ → "Thêm vào MH chính". "Để sau" ẩn 14 ngày. Không tự hỏi quyền thông báo ở đây.
 */
export function InstallBanner() {
  const t = useTranslations('pwa');
  const prompt = React.useSyncExternalStore(
    installStore.subscribe,
    installStore.getSnapshot,
    installStore.getServerSnapshot,
  );
  const [env, setEnv] = React.useState<{ visits: number; snoozed: boolean; standalone: boolean; ios: boolean } | null>(
    null,
  );
  React.useEffect(() => {
    // Đọc storage/UA sau khi mount (tránh lệch hydrate)
    const id = window.setTimeout(
      () =>
        setEnv({
          visits: countVisit(),
          snoozed: isSnoozed(),
          standalone: isStandalone(),
          ios: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
        }),
      0,
    );
    return () => window.clearTimeout(id);
  }, []);
  const mode = env ? shouldShowInstall({ ...env, hasPrompt: !!prompt }) : null;
  if (!mode) return null;

  const dismiss = () => {
    snoozeInstall();
    setEnv((e) => (e ? { ...e, snoozed: true } : e));
  };
  const install = async () => {
    const outcome = await installStore.prompt();
    if (outcome !== 'accepted') dismiss();
  };

  return (
    <section
      aria-label={mode === 'ios' ? t('iosTitle') : t('installTitle')}
      className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-xl md:right-4 md:bottom-4 md:left-auto md:mx-0"
      data-testid="install-banner"
      data-mode={mode}
    >
      <LogoMark className="size-10 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{mode === 'ios' ? t('iosTitle') : t('installTitle')}</p>
        <p className="mt-0.5 text-muted-foreground">
          {mode === 'ios' ? (
            <>
              <Share className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              {t('iosDesc')}
            </>
          ) : (
            t('installDesc')
          )}
        </p>
        {mode === 'prompt' ? (
          <div className="mt-2 flex gap-2">
            <Button variant="navy" size="sm" onClick={() => void install()} data-testid="install-cta">
              <Download aria-hidden />
              {t('installCta')}
            </Button>
            <Button variant="ghost" size="sm" onClick={dismiss} data-testid="install-later">
              {t('later')}
            </Button>
          </div>
        ) : null}
      </div>
      <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1" onClick={dismiss} aria-label={t('dismiss')}>
        <X aria-hidden />
      </Button>
    </section>
  );
}
