'use client';

import * as React from 'react';
import { captureAttribution } from '@/lib/analytics/attribution';
import { CONSENT_EVENT, type ConsentState } from '@/lib/analytics/consent';
import { trackFunnel, type ClientFunnelEvent } from '@/lib/analytics/track';

/**
 * Gửi một sự kiện phễu khi trang mở – chỉ khi đã đồng ý; người học đồng ý SAU khi trang mở → gửi lúc đó (cùng trang).
 * Dùng ở landing/marketing (`landing_view`), đăng ký (`signup_start`), checkout (`checkout_start`).
 */
export function FunnelTracker({ event, properties }: { event: ClientFunnelEvent; properties?: Record<string, string | number | boolean> }) {
  const props = React.useRef(properties);
  React.useEffect(() => {
    void trackFunnel(event, props.current);
    const onConsent = (e: Event) => {
      if ((e as CustomEvent<ConsentState>).detail?.analytics) void trackFunnel(event, props.current);
    };
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, [event]);
  return null;
}

/** Ghi attribution lần chạm đầu (UTM/referrer/trang đích) – mọi trang, một lần cho mỗi trình duyệt */
export function AttributionCapture() {
  React.useEffect(() => {
    captureAttribution(window.location.href, document.referrer);
  }, []);
  return null;
}
