import { AppShell } from '@/components/app-shell';
import { CookieBanner } from '@/features/consent/cookie-banner';

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* S10: người vào thẳng khu vực học vẫn được hỏi đồng ý cookie (sự kiện checkout_start…) */}
      <CookieBanner />
      <AppShell>{children}</AppShell>
    </>
  );
}
