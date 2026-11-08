'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RATE_LIMITED_EVENT, waitParts, type RateLimitInfo } from '@/lib/api-error-events';

/** "Thử lại sau 12 giây" đếm ngược trong toast (đơn vị phút khi ≥ 90 s) – hết giờ → "Bạn có thể thử lại." */
function WaitCountdown({ until }: { until: number }) {
  const t = useTranslations('errors');
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (now >= until) return;
    const id = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(id);
  }, [now, until]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  if (left === 0) return <span data-testid="rate-limit-ready">{t('rateLimit.ready')}</span>;
  const w = waitParts(left);
  return (
    <span data-testid="rate-limit-wait" data-seconds={left}>
      {w.unit === 'minutes' ? t('rateLimit.waitMinutes', { minutes: w.value }) : t('rateLimit.waitSeconds', { seconds: w.value })}
    </span>
  );
}

/**
 * Toast chung cho 429 `rate_limited` (S11) – một toast mỗi lúc (id cố định, request song song không chồng toast), thời gian chờ lấy
 * từ `Retry-After`/`details.retry_after_sec`, đếm ngược. Không tự gửi lại request (người học bấm lại sau khi hết giờ).
 * Khoá đăng nhập (`login_locked`) có tiêu đề riêng; form đăng nhập hiện thêm thông điệp tại chỗ.
 */
export function ApiErrorToasts() {
  const t = useTranslations('errors');
  React.useEffect(() => {
    const onRateLimited = (e: Event) => {
      const info = (e as CustomEvent<RateLimitInfo>).detail;
      if (!info) return;
      const title = info.kind === 'login_locked' ? t('rateLimit.titleLoginLocked') : info.kind === 'global_ip' ? t('rateLimit.titleGlobal') : t('rateLimit.title');
      const sec = info.retryAfterSec;
      toast.warning(title, {
        id: 'rate-limited',
        description: sec ? <WaitCountdown until={Date.now() + sec * 1000} /> : t('rateLimit.waitUnknown'),
        duration: Math.min(15_000, Math.max(5_000, (sec ?? 5) * 1000)),
      });
    };
    window.addEventListener(RATE_LIMITED_EVENT, onRateLimited);
    return () => window.removeEventListener(RATE_LIMITED_EVENT, onRateLimited);
  }, [t]);
  return null;
}
