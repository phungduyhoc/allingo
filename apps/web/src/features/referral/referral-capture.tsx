'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@allingo/ui';
import { getReferralLanding, growthKeys } from '@/lib/growth-api';
import { clearReferral, getPendingReferral, parseReferralParams, saveReferral } from '@/lib/referral';
import { useClientValue } from '@/lib/use-mounted';

/**
 * Trang đăng ký qua link giới thiệu (`/register?ref=<code>&utm_*`): lưu mã (localStorage, gửi `referral_code` khi tạo tài
 * khoản bằng mật khẩu/OTP/Google) và hiện lời mời + phần thưởng cho người mới từ `GET /referrals/{code}` (công khai).
 */
export function ReferralCapture() {
  const t = useTranslations('referral.landing');
  const search = useClientValue(() => window.location.search, '');
  const fromUrl = React.useMemo(() => parseReferralParams(search), [search]);
  const stored = useClientValue(() => getPendingReferral()?.code ?? null, null);
  const code = fromUrl?.code ?? stored;

  React.useEffect(() => {
    if (fromUrl) saveReferral(fromUrl);
  }, [fromUrl]);

  const landing = useQuery({ queryKey: growthKeys.referralLanding(code ?? ''), queryFn: () => getReferralLanding(code!), enabled: !!code, retry: false, staleTime: 5 * 60_000 });

  React.useEffect(() => {
    if (landing.data && !landing.data.valid) clearReferral();
  }, [landing.data]);

  if (!code) return null;
  if (landing.data && !landing.data.valid) {
    return (
      <Alert variant="destructive" className="w-full max-w-md" data-testid="referral-banner" data-valid="false">
        <AlertDescription>{t('invalid', { code })}</AlertDescription>
      </Alert>
    );
  }
  const reward = landing.data?.reward.referee_started ?? null;
  return (
    <Alert variant="gold" className="w-full max-w-md" data-testid="referral-banner" data-code={code} data-valid={landing.data ? 'true' : 'pending'}>
      <Gift aria-hidden />
      <AlertTitle>{landing.data?.referrer_name ? t('invitedBy', { name: landing.data.referrer_name }) : t('invited')}</AlertTitle>
      <AlertDescription>
        {reward ? t('reward', { credits: reward, upgraded: landing.data?.reward.referee_upgraded ?? 0 }) : t('rewardGeneric')}
        <span className="mt-1 block text-xs opacity-80">{t('code', { code })}</span>
      </AlertDescription>
    </Alert>
  );
}
