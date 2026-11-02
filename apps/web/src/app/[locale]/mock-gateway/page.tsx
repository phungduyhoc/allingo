import * as React from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { MockGateway } from '@/features/mock-gateway/mock-gateway';

/**
 * Cổng thanh toán GIẢ LẬP cho chế độ mock (NEXT_PUBLIC_API_MOCK=1, dev/E2E) – tương đương trang
 * `/v1/payments/mock/checkout` của API: nút `data-outcome` = paid | failed | cancelled | paid-drop. Bản build thật → 404.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (process.env.NEXT_PUBLIC_API_MOCK !== '1') notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <React.Suspense fallback={null}>
      <MockGateway />
    </React.Suspense>
  );
}
