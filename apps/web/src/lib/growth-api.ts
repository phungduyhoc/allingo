import { unwrap } from '@allingo/api-client';
import {
  notificationItemSchema,
  notificationManageSchema,
  notificationReadAllResultSchema,
  referralLandingSchema,
  referralSummarySchema,
  type NotificationCategories,
  type NotificationItem,
  type NotificationManage,
  type ReferralLanding,
  type ReferralSummary,
} from '@allingo/schemas';
import { getApi } from './api';
import { parseOr } from './zod-parse';

/** Lời gọi API Growth (S8): referral, thông báo in-app, trang quản lý thông báo theo token email (không cần đăng nhập). */

export const growthKeys = {
  referral: ['me', 'referral'] as const,
  referralLanding: (code: string) => ['referrals', code] as const,
  notifications: ['me', 'notifications', 'feed'] as const,
  manage: (token: string) => ['notifications', 'manage', token] as const,
};

export async function getReferral(): Promise<ReferralSummary> {
  return parseOr(referralSummarySchema, unwrap(await getApi().GET('/me/referral')));
}

export async function getReferralLanding(code: string): Promise<ReferralLanding> {
  return parseOr(referralLandingSchema, unwrap(await getApi().GET('/referrals/{code}', { params: { path: { code } } })));
}

export interface NotificationPage {
  data: NotificationItem[];
  next_cursor: string | null;
  unread_count: number;
}

export async function listNotifications(q: { unread?: boolean; cursor?: string | null; limit?: number } = {}): Promise<NotificationPage> {
  const query = { limit: q.limit ?? 20, ...(q.unread ? { unread: true } : {}), ...(q.cursor ? { cursor: q.cursor } : {}) };
  const d = (unwrap(await getApi().GET('/me/notifications', { params: { query } as never })) ?? {}) as { data?: unknown[]; next_cursor?: string | null; unread_count?: number };
  const data = (d.data ?? []).map((x) => parseOr(notificationItemSchema, x));
  return { data, next_cursor: d.next_cursor ?? null, unread_count: typeof d.unread_count === 'number' ? d.unread_count : data.filter((n) => !n.read_at).length };
}

export async function markNotificationRead(notificationId: string): Promise<NotificationItem> {
  return parseOr(notificationItemSchema, unwrap(await getApi().POST('/me/notifications/{notificationId}/read', { params: { path: { notificationId } } })));
}

export async function markAllNotificationsRead(): Promise<{ updated: number; unread_count: number }> {
  return parseOr(notificationReadAllResultSchema, unwrap(await getApi().POST('/me/notifications/read-all')));
}

export async function getNotificationManage(token: string): Promise<NotificationManage> {
  return parseOr(notificationManageSchema, unwrap(await getApi().GET('/notifications/manage', { params: { query: { token } } })));
}

export interface ManagePatch {
  categories?: { [K in keyof NotificationCategories]?: Partial<NotificationCategories[K]> };
  channels?: { email?: boolean };
}

export async function patchNotificationManage(token: string, body: ManagePatch): Promise<NotificationManage> {
  return parseOr(notificationManageSchema, unwrap(await getApi().PATCH('/notifications/manage', { params: { query: { token } }, body: body as never })));
}
