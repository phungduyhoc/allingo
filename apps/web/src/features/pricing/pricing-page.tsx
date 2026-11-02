import * as React from 'react';
import { getTranslations } from 'next-intl/server';
import { Spinner } from '@allingo/ui';
import { PricingClient } from './pricing-client';

/**
 * Trang Bảng giá (S7/S8): khung tĩnh (SSG) + phần client đọc `GET /plans?program=` (công khai), `GET /payments/providers`,
 * phiên hiện tại (khách → đăng ký trước khi mua), mã khuyến mãi xem trước giá (`POST /promotions/validate`), dùng thử Pro 7 ngày
 * (`POST /promotions/redeem`). Quyền lợi đọc từ `FEATURE_GATES` + `plans[].features`; không ghi số tiền/hạn mức cứng.
 */
export async function PricingPage({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'pricing' });
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-12 sm:px-6 sm:py-16" data-testid="pricing-page">
      <header className="mx-auto max-w-2xl space-y-3 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy sm:text-4xl dark:text-foreground">{t('title')}</h1>
        <p className="text-lg text-muted-foreground">{t('subtitle')}</p>
      </header>
      <React.Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        }
      >
        <PricingClient />
      </React.Suspense>
    </div>
  );
}
