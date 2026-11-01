import { AuthGate } from '@/features/auth/auth-gate';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
