'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { parseRateLimited, waitParts } from './api-error-events';
import { getErrorCode } from './errors';
import { parseFeatureDisabled } from './flags';

/**
 * Thông điệp lỗi API hiển thị tại chỗ (form, khung thao tác): S11 thêm thời gian chờ cho 429 `rate_limited`, thông điệp riêng khi
 * khoá đăng nhập (`details.reason = login_locked`) và kill-switch (`errors.feature_disabled`); còn lại `errors.codes.<code>`.
 */
export function useErrorMessage(): (err: unknown) => string {
  const te = useTranslations('errors');
  return React.useCallback(
    (err: unknown) => {
      const rl = parseRateLimited(err);
      if (rl) {
        const w = waitParts(rl.retryAfterSec);
        const wait = w.unit === 'seconds' ? te('rateLimit.waitSeconds', { seconds: w.value }) : w.unit === 'minutes' ? te('rateLimit.waitMinutes', { minutes: w.value }) : te('rateLimit.waitUnknown');
        return rl.kind === 'login_locked' ? te('rateLimit.loginLocked', { wait }) : te('rateLimit.message', { wait });
      }
      if (parseFeatureDisabled(err)) return te('feature_disabled');
      return te(`codes.${getErrorCode(err)}`);
    },
    [te],
  );
}
