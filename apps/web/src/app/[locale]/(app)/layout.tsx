import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { pickMessages } from '@/lib/i18n-scope';
import { APP_LAYOUT_MESSAGES } from '@/lib/i18n-app-scopes';
import { AuthGate } from '@/features/auth/auth-gate';
import { QuotaToastListener } from '@/features/quota/quota-toast-listener';
import { RealtimeProvider } from '@/features/realtime/realtime-provider';
import { BetaGateListener } from '@/features/beta/beta-gate-listener';
import { MfaStepUpProvider } from '@/features/security/mfa-step-up-provider';

export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Giữ render tĩnh (không đọc headers) khi NextIntlClientProvider lấy thông điệp
  setRequestLocale(locale);
  // S11: chỉ thông điệp của lớp khu vực học (AuthGate, AppShell, gia sư, thông báo…); từng trang cấp phần của mình qua <PageIntl>
  const messages = pickMessages(await getMessages(), APP_LAYOUT_MESSAGES);
  return (
    <NextIntlClientProvider messages={messages}>
      <AuthGate>
        <RealtimeProvider>{children}</RealtimeProvider>
        <QuotaToastListener />
        {/* S12: 403 beta_required → /beta; 403 mfa_required (admin) → hộp thoại step-up rồi gửi lại request */}
        <BetaGateListener />
        <MfaStepUpProvider />
      </AuthGate>
    </NextIntlClientProvider>
  );
}
