'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PayResult } from '@allingo/schemas';
import { buttonVariants, cn, Spinner } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { billingKeys, getOrder } from '@/lib/billing-api';
import { isSettledOrderStatus } from '@/lib/billing';

/**
 * Thanh toán dạng QR / deeplink (MoMo, ZaloPay…): hiện mã QR (ảnh data:/https hoặc chuỗi VietQR), nút mở ứng dụng ví, và theo dõi
 * trạng thái đơn (polling 3 s) – có kết quả → sang trang kết quả. Quyền chỉ mở khi webhook xác nhận (server).
 */
export function PaymentQr({ pay }: { pay: PayResult }) {
  const t = useTranslations('checkout');
  const router = useRouter();
  const order = useQuery({
    queryKey: billingKeys.order(pay.order_id),
    queryFn: () => getOrder(pay.order_id),
    refetchInterval: 3_000,
  });
  const settled = !!order.data && isSettledOrderStatus(order.data.status);
  React.useEffect(() => {
    if (settled) router.push(`/checkout/result?order_id=${pay.order_id}&provider=${pay.provider}`);
  }, [settled, router, pay.order_id, pay.provider]);
  const qr = pay.qr_code;
  const isImage = !!qr && (qr.startsWith('data:image') || /^https?:\/\//.test(qr));
  return (
    <div className="space-y-4" data-testid="payment-qr" data-method={pay.method}>
      {qr ? (
        isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh QR động do cổng thanh toán trả (data:/https), không tối ưu qua next/image
          <img src={qr} alt={t('qrAlt')} className="mx-auto size-56 rounded-lg border border-border bg-white p-2" />
        ) : (
          <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs break-all whitespace-pre-wrap">{qr}</pre>
        )
      ) : null}
      {pay.deeplink ? (
        <a href={pay.deeplink} className={cn(buttonVariants({ variant: 'navy' }), 'w-full')}>
          <Smartphone aria-hidden />
          {t('openWallet')}
        </a>
      ) : null}
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Spinner aria-hidden />
        {t('waiting')} {order.data ? `(${t(`status.${order.data.status}`)})` : null}
      </p>
      <Link href={`/checkout/result?order_id=${pay.order_id}&provider=${pay.provider}`} className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
        <ExternalLink aria-hidden />
        {t('iHavePaid')}
      </Link>
    </div>
  );
}
