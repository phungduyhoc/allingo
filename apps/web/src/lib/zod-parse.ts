import type { z } from 'zod';
import type { Page } from './types';

/**
 * Validate phản hồi API bằng Zod của packages/schemas; sai dạng → dùng dữ liệu thô đã ép kiểu (không chặn UI vì một trường
 * thêm/thiếu – server là nguồn sự thật). Dùng chung cho các tệp `*-api.ts` (S7/S8).
 */
export function parseOr<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  return r.success ? r.data : (data as T);
}

/** Trang cursor `{ data, next_cursor }` – mỗi phần tử validate riêng */
export function pageOf<T>(schema: z.ZodType<T>, data: unknown): Page<T> {
  const d = (data ?? {}) as { data?: unknown[]; next_cursor?: string | null };
  return { data: (d.data ?? []).map((x) => parseOr(schema, x)), next_cursor: d.next_cursor ?? null };
}
