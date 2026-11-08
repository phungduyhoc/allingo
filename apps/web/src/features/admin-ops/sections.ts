/** Mục quản trị vận hành S12 – module thường (không 'use client') để route RSC `admin/[section]` kiểm tra tham số */
export const ADMIN_SECTIONS = ['beta', 'feedback', 'content', 'support', 'users', 'ai', 'system', 'audit'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];
export const isAdminSection = (s: string): s is AdminSection => (ADMIN_SECTIONS as readonly string[]).includes(s);
