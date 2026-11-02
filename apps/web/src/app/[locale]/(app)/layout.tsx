import { AuthGate } from '@/features/auth/auth-gate';
import { QuotaToastListener } from '@/features/quota/quota-toast-listener';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      {children}
      <QuotaToastListener />
    </AuthGate>
  );
}
