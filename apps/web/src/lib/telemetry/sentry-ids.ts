/** Id ngẫu nhiên hex cho trace/span/event (Web Crypto) – tách riêng để `trace.ts` không kéo cả client Sentry */
export function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
export const newTraceId = () => randomHex(16);
export const newSpanId = () => randomHex(8);

/** W3C traceparent `00-<trace>-<span>-01` (lấy mẫu) */
export function traceparent(traceId: string): string {
  return `00-${traceId}-${newSpanId()}-01`;
}
