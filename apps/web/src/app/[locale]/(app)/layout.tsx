import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { AuthGate } from '@/features/auth/auth-gate';
import { QuotaToastListener } from '@/features/quota/quota-toast-listener';
import { RealtimeProvider } from '@/features/realtime/realtime-provider';

export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Giữ render tĩnh (không đọc headers) khi NextIntlClientProvider lấy thông điệp
  setRequestLocale(locale);
  // Khu vực học: toàn bộ thông điệp (S11: tách theo trang)
  return (
    <NextIntlClientProvider>
      <AuthGate>
        <RealtimeProvider>{children}</RealtimeProvider>
        <QuotaToastListener />
      </AuthGate>
    </NextIntlClientProvider>
  );
}
