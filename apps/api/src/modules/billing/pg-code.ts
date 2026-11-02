/** Mã lỗi Postgres (drizzle bọc lỗi postgres.js trong `cause`) */
export function pgCode(err: unknown): string | undefined {
  let e = err as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    e = e.cause as typeof e;
  }
  return undefined;
}
