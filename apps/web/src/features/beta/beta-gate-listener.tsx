'use client';

import * as React from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { BETA_REQUIRED_EVENT, isBetaExemptPath } from '@/lib/beta';

/**
 * S12 – beta gate toàn cục: một request bất kỳ trong khu vực học nhận 403 `beta_required` (QueryCache/MutationCache →
 * `notifyApiError`) → chuyển tới `/beta?next=<trang hiện tại>`. Trang được miễn (hỗ trợ, cài đặt/bảo mật, chính /beta) giữ nguyên –
 * API cũng miễn các endpoint tương ứng (A194). Chỉ gắn trong layout (app) nên landing/marketing không bao giờ bị chuyển hướng.
 */
export function BetaGateListener() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = React.useRef(pathname);
  React.useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    let last = 0;
    const onBeta = () => {
      const p = pathRef.current;
      if (isBetaExemptPath(p)) return;
      // Nhiều query lỗi cùng lúc → một lần chuyển trang
      const now = Date.now();
      if (now - last < 3000) return;
      last = now;
      const next = `${p}${window.location.search}`;
      router.replace(`/beta?next=${encodeURIComponent(next)}`);
    };
    window.addEventListener(BETA_REQUIRED_EVENT, onBeta);
    return () => window.removeEventListener(BETA_REQUIRED_EVENT, onBeta);
  }, [router]);

  return null;
}
