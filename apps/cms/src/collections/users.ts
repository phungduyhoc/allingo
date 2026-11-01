import type { CollectionConfig } from 'payload';
import { isAdmin, isAdminField, isAdminOrSelf, roleOf } from '../lib/access';

/**
 * Người dùng CMS (biên tập viên/giáo viên/quản trị). Tách biệt với iam.users của người học;
 * `apiUserEmail` là email tương ứng bên API để ghi `created_by_email` khi phát hành (ADR-0019).
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    tokenExpiration: 60 * 60 * 8,
    maxLoginAttempts: 5,
    lockTime: 30 * 60 * 1000,
  },
  labels: { singular: { vi: 'Người dùng CMS', en: 'CMS user' }, plural: { vi: 'Người dùng CMS', en: 'CMS users' } },
  admin: { useAsTitle: 'email', defaultColumns: ['email', 'name', 'role'], group: { vi: 'Hệ thống', en: 'System' } },
  access: {
    read: isAdminOrSelf,
    create: isAdmin,
    update: isAdminOrSelf,
    delete: isAdmin,
    // Chỉ admin xem danh sách người dùng trong admin UI
    admin: ({ req }) => roleOf(req) !== null,
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: { vi: 'Họ tên', en: 'Name' } },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: [
        { label: { vi: 'Biên tập viên', en: 'Editor' }, value: 'editor' },
        { label: { vi: 'Giáo viên (duyệt)', en: 'Teacher (reviewer)' }, value: 'teacher' },
        { label: { vi: 'Quản trị', en: 'Admin' }, value: 'admin' },
      ],
      label: { vi: 'Vai trò', en: 'Role' },
      // Chỉ admin được đổi vai trò (tránh tự nâng quyền)
      access: { update: isAdminField, create: isAdminField },
      saveToJWT: true,
    },
    {
      name: 'apiUserEmail',
      type: 'email',
      label: { vi: 'Email tài khoản API (created_by_email)', en: 'API account email' },
      admin: { description: { vi: 'Email của tài khoản tương ứng trong iam.users; dùng làm created_by_email khi phát hành.', en: 'Matching iam.users email; sent as created_by_email on publish.' } },
    },
  ],
};
