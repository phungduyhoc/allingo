import type { Access, FieldAccess, PayloadRequest } from 'payload';
import { isCmsRole, type CmsRole } from './workflow';

/** Trích vai trò CMS từ req.user (collection `users`, field `role`) */
export function roleOf(req: PayloadRequest): CmsRole | null {
  const user = req.user as { role?: unknown; collection?: string } | null | undefined;
  if (!user) return null;
  return isCmsRole(user.role) ? user.role : null;
}

export const isLoggedIn: Access = ({ req }) => roleOf(req) !== null;

export const hasRole =
  (...roles: CmsRole[]): Access =>
  ({ req }) => {
    const r = roleOf(req);
    return r !== null && roles.includes(r);
  };

export const isAdmin: Access = hasRole('admin');
export const isReviewer: Access = hasRole('teacher', 'admin');

export const isAdminField: FieldAccess = ({ req }) => roleOf(req) === 'admin';

/** Người dùng chỉ đọc/sửa chính mình trừ khi là admin */
export const isAdminOrSelf: Access = ({ req }) => {
  const r = roleOf(req);
  if (r === 'admin') return true;
  if (!req.user) return false;
  return { id: { equals: req.user.id } };
};
