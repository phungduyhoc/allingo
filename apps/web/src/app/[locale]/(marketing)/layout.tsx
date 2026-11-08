import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { MARKETING_MESSAGES, pickMessages } from '@/lib/i18n-scope';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { HydrateLater } from '@/features/marketing/blocks';
import { CookieBanner } from '@/features/consent/cookie-banner';

export default async function MarketingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Cần gọi ở mọi layout/page để next-intl render tĩnh (SSG) các trang marketing
  setRequestLocale(locale);
  // S10: chỉ thông điệp component client của marketing (header, đồng ý cookie, câu mẫu, đăng nhập/đăng ký, đăng ký chờ)
  const messages = pickMessages(await getMessages(), MARKETING_MESSAGES);
  return (
    <NextIntlClientProvider messages={messages}>
    <div className="flex min-h-dvh flex-col">
      {/* S10: thanh đồng ý cookie trong luồng trang (không phủ nội dung, không CLS) */}
      <CookieBanner />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <HydrateLater>
        <SiteFooter />
      </HydrateLater>
    </div>
    </NextIntlClientProvider>
  );
}
