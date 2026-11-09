import { isProgramCode } from '@allingo/schemas/program/registry';
import { ADMIN_TABS } from '@/features/admin/admin-tabs';
import { ADMIN_SECTIONS } from '@/features/admin-ops/sections';

/**
 * B6/S152 – HTTP 404 thật cho trang không tồn tại trong nhóm (app).
 *
 * Nguyên nhân 200: layout (app) bọc trang trong `AuthGate` (client) – khi SSR, AuthGate chỉ vẽ spinner (chưa biết phiên vì cookie
 * httpOnly thuộc origin API), nên `notFound()` của page server component nằm trong cây con KHÔNG được SSR duyệt tới → Next đã gửi
 * 200 trước khi lỗi hiện ra ở client. Kiểm tra "trang có tồn tại" vì vậy chạy ở server TRƯỚC khi render (proxy): đường dẫn có
 * tham số sai dạng (mục admin không có, tab billing không có, id không phải UUID) → rewrite sang trang not-found → 404.
 * Tài nguyên hợp lệ về dạng nhưng không tồn tại/không thuộc người dùng (UUID đúng dạng) chỉ biết được sau khi gọi API bằng phiên
 * của người dùng → vẫn là trạng thái "không tìm thấy" ở client (A224).
 * C1: `/<mã lạ>/dashboard|practice|…` → 404 (chương trình hợp lệ nhưng chưa có nội dung → trang "sắp ra mắt", HTTP 200).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS: readonly string[] = ['billing', ...ADMIN_SECTIONS];
const BILLING_TABS: readonly string[] = ADMIN_TABS;

/** Trang dưới `/[program]` (app/[locale]/(app)/(shell)/[program]) */
const PROGRAM_AREA_PAGES = ['dashboard', 'diagnostic', 'errors', 'plan', 'practice', 'stats', 'test-sets', 'today', 'vocab'];
/** Đoạn đầu là route tĩnh của [locale] (không phải mã chương trình) – không áp quy tắc chương trình */
const STATIC_TOP_SEGMENTS: ReadonlySet<string> = new Set(['account', 'admin', 'attempts', 'badges', 'checkout', 'lessons', 'notes', 'notifications', 'onboarding', 'referral', 'settings', 'support', 'vocab', 'about', 'beta', 'blog', 'contact', 'legal', 'login', 'pricing', 'privacy', 'register', 'signup', 'terms', 'r', 'mock-gateway', 'offline']);

const RULES: ReadonlyArray<{ re: RegExp; ok: (m: RegExpExecArray) => boolean }> = [
  // /admin/<mục> – S12 (8 mục) + billing (S8)
  { re: /^\/admin\/([^/]+)$/, ok: (m) => SECTIONS.includes(m[1]!) },
  // /admin/billing/<tab>[/…] – một cấp tab
  { re: /^\/admin\/billing\/([^/]+)(\/.*)?$/, ok: (m) => !m[2] && BILLING_TABS.includes(m[1]!) },
  // /attempts/<uuid>, /attempts/<uuid>/result|review
  { re: /^\/attempts\/([^/]+)(?:\/(?:result|review))?$/, ok: (m) => UUID.test(m[1]!) },
  { re: /^\/support\/tickets\/([^/]+)$/, ok: (m) => UUID.test(m[1]!) },
  { re: /^\/account\/orders\/([^/]+)$/, ok: (m) => UUID.test(m[1]!) },
  // C1: khu học theo chương trình `/[program]/<trang>` – mã chương trình phải thuộc catalog.programs (registry); đoạn đầu là route
  // tĩnh khác (blog, legal…) thì để Next tự khớp route của nó
  { re: new RegExp(`^/([^/]+)/(?:${PROGRAM_AREA_PAGES.join('|')})(?:/.*)?$`), ok: (m) => isProgramCode(m[1]) || STATIC_TOP_SEGMENTS.has(m[1]!) },
];

/** Đường dẫn (đã bỏ tiền tố locale) thuộc route động của nhóm (app) nhưng tham số sai dạng → trang không tồn tại */
export function isMissingAppRoute(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const r of RULES) {
    const m = r.re.exec(p);
    if (m) return !r.ok(m);
  }
  return false;
}

/** Đích rewrite cho trang không tồn tại – rơi vào route bắt-mọi `[locale]/[...rest]` (không qua AuthGate) → `notFound()` → 404 */
export const NOT_FOUND_REWRITE_SEGMENT = '_not-found';
