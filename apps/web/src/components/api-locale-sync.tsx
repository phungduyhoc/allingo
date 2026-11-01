'use client';

import * as React from 'react';
import { setApiLocale } from '@/lib/api';

/** Đồng bộ locale giao diện → header Accept-Language của API client */
export function ApiLocaleSync({ locale }: { locale: string }) {
  React.useEffect(() => setApiLocale(locale), [locale]);
  return null;
}
