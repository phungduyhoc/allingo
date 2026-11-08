'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { env } from '@/env';
import { rotatePageTrace, getPageTraceId } from '@/lib/telemetry/trace';
import type { CaptureContext, SentryClient, VitalMetric } from '@/lib/telemetry/sentry';

/**
 * Báo lỗi + Web Vitals RUM của web (S11) – chỉ khi có `NEXT_PUBLIC_SENTRY_DSN`; mã client Sentry nạp lười (chunk riêng) nên trang
 * không trả thêm JS khi tắt. Lỗi không bắt được (window `error`/`unhandledrejection`) → phiên `crashed`; lỗi đã bắt (error.tsx,
 * `captureException`) → `errored`. Web Vitals gom theo route, gửi khi trang ẩn / đổi route.
 */
let clientPromise: Promise<SentryClient | null> | null = null;
const pendingVitals: VitalMetric[] = [];

export function getSentry(): Promise<SentryClient | null> {
  if (!env.sentryDsn || typeof window === 'undefined') return Promise.resolve(null);
  clientPromise ??= import('@/lib/telemetry/sentry')
    .then(({ SentryClient: Client }) => {
      const c = new Client({
        dsn: env.sentryDsn!,
        release: env.sentryRelease,
        environment: env.sentryEnvironment,
        sampleRate: env.sentrySampleRate,
        vitalsSampleRate: env.sentryVitalsSampleRate,
        getTraceId: getPageTraceId,
      });
      for (const m of pendingVitals.splice(0)) c.recordVital(m);
      return c;
    })
    .catch(() => null);
  return clientPromise;
}

/** Báo một lỗi đã bắt (error boundary, luồng tự xử lý) – no-op khi Sentry tắt */
export function captureException(err: unknown, ctx?: CaptureContext): void {
  if (!env.sentryDsn) return;
  void getSentry().then((c) => c?.captureException(err, ctx));
}

/** Hàm ổn định (module) – `useReportWebVitals` đăng ký lại nếu callback đổi mỗi lần render */
function reportVital(m: { name: string; value: number; rating?: string; navigationType?: string }): void {
  if (!env.sentryDsn) return;
  const metric = { name: m.name, value: m.value, rating: m.rating, navigationType: m.navigationType };
  if (clientPromise) void clientPromise.then((c) => c?.recordVital(metric));
  else pendingVitals.push(metric);
}

export function Telemetry() {
  const pathname = usePathname();

  useReportWebVitals(reportVital);

  React.useEffect(() => {
    rotatePageTrace(pathname);
    if (env.sentryDsn) void getSentry().then((c) => c?.setRoute(pathname));
  }, [pathname]);

  React.useEffect(() => {
    if (!env.sentryDsn) return;
    let client: SentryClient | null = null;
    const onError = (e: ErrorEvent) => {
      // Lỗi tải script/ảnh (không có error) và lỗi từ script khác origin ("Script error.") – bỏ qua
      if (!e.error && (!e.message || e.message === 'Script error.')) return;
      client?.captureException(e.error ?? e.message, { handled: false });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      // Huỷ request (AbortError) khi rời trang không phải sự cố
      const r = e.reason as { name?: string } | undefined;
      if (r && r.name === 'AbortError') return;
      client?.captureException(e.reason, { handled: false, tags: { mechanism: 'unhandledrejection' } });
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') client?.flushVitals(true);
    };
    const onPageHide = () => client?.endSession();
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    void getSentry().then((c) => {
      client = c;
      c?.startSession();
    });
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  return null;
}
