'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@allingo/ui';

const VARIANT: Record<string, 'success' | 'gold' | 'destructive' | 'muted' | 'outline' | 'secondary'> = {
  paid: 'success',
  pending: 'gold',
  failed: 'destructive',
  cancelled: 'muted',
  expired: 'muted',
  refunded: 'outline',
};

export function OrderStatusBadge({ status }: { status: string }) {
  const t = useTranslations('checkout');
  return (
    <Badge variant={VARIANT[status] ?? 'secondary'} data-testid="order-status" data-status={status}>
      {t.has(`status.${status}`) ? t(`status.${status}`) : status}
    </Badge>
  );
}
