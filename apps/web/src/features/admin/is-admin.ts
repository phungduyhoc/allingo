import type { User } from '@/lib/types';

/** Vai trò được vào trang billing admin (CHỈ để ẩn menu/chặn route phía client – server kiểm tra lại, 403 khi thiếu quyền) */
export const ADMIN_ROLES = ['admin', 'superadmin'] as const;

export function isAdmin(user: Pick<User, 'roles'> | null | undefined): boolean {
  return !!user?.roles?.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
}
