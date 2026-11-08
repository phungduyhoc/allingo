'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Spinner } from '@allingo/ui';
import { useRouter } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { UNAUTHORIZED_EVENT } from '@/lib/api';
import { isApiError } from '@/lib/errors';
import { ErrorState } from '@/components/states';

/**
 * Bảo vệ các route (app): GET /me 401 → về landing. Làm ở client vì cookie httpOnly do API (origin khác) đặt,
 * Next proxy không đọc được. Cũng lắng nghe sự kiện refresh thất bại từ API client.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const router = useRouter();
  const me = useMe();

  React.useEffect(() => {
    const onUnauthorized = () => router.replace('/');
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);

  React.useEffect(() => {
    if (me.isError && isApiError(me.error) && me.error.status === 401) router.replace('/');
  }, [me.isError, me.error, router]);

  // Sau queryClient.clear() (đăng xuất/đổi tài khoản) truy vấn /me về pending mà không tự tải lại → tải lại để không kẹt spinner
  const { isPending, fetchStatus, refetch } = me;
  React.useEffect(() => {
    if (isPending && fetchStatus === 'idle') void refetch();
  }, [isPending, fetchStatus, refetch]);

  // S11 (hiệu năng): /me xong → dựng cả AppShell + trang trong transition (React chia nhỏ ~5 ms/lần, không khoá luồng chính
  // hàng trăm ms như lần dựng đồng bộ do useSyncExternalStore của TanStack); spinner giữ tới khi cây mới commit
  const ready = !!me.data;
  const [revealed, setRevealed] = React.useState(false);
  React.useEffect(() => {
    if (ready && !revealed) React.startTransition(() => setRevealed(true));
  }, [ready, revealed]);

  if (me.isPending || (ready && !revealed)) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy>
        <Spinner label={t('loading')} className="text-navy dark:text-accent" />
      </div>
    );
  }
  if (me.isError) {
    if (isApiError(me.error) && me.error.status === 401) return null;
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </div>
    );
  }
  return <>{children}</>;
}
