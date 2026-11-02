'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { queryKeys } from '@/lib/queries';
import { QUOTA_EXCEEDED_EVENT, resetParts, type QuotaInfo } from '@/lib/quota';
import { UPGRADE_HREF } from './quota-ui';

/**
 * Xử lý 429 `quota_exceeded` chung cho mọi màn trong (app): toast (một cái mỗi lúc) gồm tính năng hết lượt, thời điểm reset
 * theo giờ Việt Nam và nút Nâng cấp → /pricing; làm mới /me/entitlements để thanh hạn mức cập nhật. Chi tiết theo ngữ cảnh
 * (giải thích, mở đề) vẫn hiện tại chỗ bằng QuotaExceededNotice.
 */
export function QuotaToastListener() {
  const t = useTranslations('quota');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();

  React.useEffect(() => {
    const onQuota = (e: Event) => {
      const info = (e as CustomEvent<QuotaInfo>).detail;
      if (!info) return;
      void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
      const parts = resetParts(info.resetAt, locale);
      const feature = t.has(`feature.${info.feature}` as never) ? t(`feature.${info.feature}` as never) : t('feature.unknown');
      toast.warning(t('exceededTitle', { period: info.period, feature }), {
        id: 'quota-exceeded',
        description: parts ? t('resetAt', { ...parts }) : t('exceededHint'),
        action: { label: t('upgradeCta'), onClick: () => router.push(UPGRADE_HREF) },
        duration: 8000,
      });
    };
    window.addEventListener(QUOTA_EXCEEDED_EVENT, onQuota);
    return () => window.removeEventListener(QUOTA_EXCEEDED_EVENT, onQuota);
  }, [locale, qc, router, t]);

  return null;
}
