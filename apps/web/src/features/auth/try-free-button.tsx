'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@allingo/ui';
import { useRouter } from '@/i18n/navigation';
import { useStartGuest } from '@/lib/guest';

/**
 * "Luyện thử miễn phí": nếu chưa có phiên → POST /auth/guest (cookie + guest_token) rồi vào dashboard.
 * Nếu đã có phiên (khách hoặc thật) → vào thẳng dashboard.
 */
export function TryFreeButton({ children, ...props }: ButtonProps) {
  const t = useTranslations('landing');
  const ta = useTranslations('auth');
  const router = useRouter();
  const start = useStartGuest();

  return (
    <Button
      {...props}
      disabled={start.isPending || props.disabled}
      onClick={() => {
        start.mutate(undefined, {
          onSuccess: () => router.push('/toeic/dashboard'),
          onError: () => toast.error(ta('guestFailed')),
        });
      }}
    >
      {start.isPending ? ta('creatingGuest') : (children ?? t('ctaTry'))}
    </Button>
  );
}
