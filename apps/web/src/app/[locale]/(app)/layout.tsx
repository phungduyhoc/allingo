import { AuthGate } from '@/features/auth/auth-gate';
import { QuotaToastListener } from '@/features/quota/quota-toast-listener';
import { RealtimeProvider } from '@/features/realtime/realtime-provider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <RealtimeProvider>{children}</RealtimeProvider>
      <QuotaToastListener />
    </AuthGate>
  );
}
