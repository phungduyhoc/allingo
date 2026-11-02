import type { UserDirectory } from '../../shared/events/user-directory.js';

/**
 * S10: gắn `user_email` vào danh sách admin billing (đơn, thanh toán, hoá đơn, subscription) – chỉ endpoint vai trò admin
 * (`@Roles('admin','superadmin')`), đọc qua UserDirectory (không truy vấn iam.users), KHÔNG ghi log (CLAUDE.md §9).
 */
export async function withUserEmails<T extends { user_id?: string | null }>(users: UserDirectory, rows: T[]): Promise<Array<T & { user_email: string | null }>> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const contacts = ids.length ? await users.contacts(ids) : [];
  const email = new Map(contacts.map((c) => [c.id, c.email]));
  return rows.map((r) => ({ ...r, user_email: r.user_id ? (email.get(r.user_id) ?? null) : null }));
}
