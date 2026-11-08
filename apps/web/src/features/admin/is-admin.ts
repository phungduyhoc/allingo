import type { User } from '@/lib/types';

/** Vai trò được vào trang billing admin (CHỈ để ẩn menu/chặn route phía client – server kiểm tra lại, 403 khi thiếu quyền) */
export const ADMIN_ROLES = ['admin', 'superadmin'] as const;

export function isAdmin(user: Pick<User, 'roles'> | null | undefined): boolean {
  return !!user?.roles?.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
}

/** B2: nhân sự nội dung vào được `/admin/content` (hàng chờ duyệt, nhập Excel, AI soạn đề) – server vẫn kiểm vai trò + máy trạng thái */
export const CONTENT_STAFF_ROLES = ['editor', 'teacher', 'admin', 'superadmin'] as const;

export function isContentStaff(user: Pick<User, 'roles'> | null | undefined): boolean {
  return !!user?.roles?.some((r) => (CONTENT_STAFF_ROLES as readonly string[]).includes(r));
}

/** Vai trò duyệt (teacher/admin) – phân công reviewer, duyệt vòng 1/2 */
export function isReviewer(user: Pick<User, 'roles'> | null | undefined): boolean {
  return !!user?.roles?.some((r) => ['teacher', 'admin', 'superadmin'].includes(r));
}
