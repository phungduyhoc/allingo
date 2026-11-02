'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { env } from '@/env';
import { getApiFetch } from '@/lib/api';
import { useMounted } from '@/lib/use-mounted';

const OUTCOMES = [
  { outcome: 'paid', label: 'Pay (success)' },
  { outcome: 'failed', label: 'Fail' },
  { outcome: 'cancelled', label: 'Cancel' },
  { outcome: 'paid-drop', label: 'Success but webhook lost (test payment.reconcile)' },
] as const;

/** Công cụ dev (không phải giao diện người dùng cuối – không i18n, giống trang mock của API) */
export function MockGateway() {
  const ref = useSearchParams().get('ref') ?? '';
  const [busy, setBusy] = React.useState(false);
  // Nút chỉ bấm được sau hydrate (tránh bấm trước khi React gắn handler)
  const mounted = useMounted();
  const submit = async (outcome: (typeof OUTCOMES)[number]['outcome']) => {
    setBusy(true);
    const drop = outcome === 'paid-drop';
    const res = await getApiFetch()(`${env.apiUrl}/payments/mock/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ref, outcome: drop ? 'paid' : outcome, drop_webhook: drop ? '1' : undefined }),
    });
    const data = (await res.json()) as { redirect_url?: string };
    if (data.redirect_url) window.location.assign(data.redirect_url);
    else setBusy(false);
  };
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 420, margin: '40px auto', padding: '0 16px' }} data-testid="mock-gateway">
      <h1>Mock gateway</h1>
      <p>
        ref: <code>{ref}</code>
      </p>
      {OUTCOMES.map((o) => (
        <button
          key={o.outcome}
          type="button"
          data-outcome={o.outcome}
          disabled={busy || !mounted}
          onClick={() => void submit(o.outcome)}
          style={{ width: '100%', padding: 12, margin: '6px 0', fontSize: 16, cursor: 'pointer' }}
        >
          {o.label}
        </button>
      ))}
    </main>
  );
}
