import type { AbstractIntlMessages } from 'next-intl';

/**
 * S10 (hiệu năng): chỉ gửi xuống trình duyệt các nhánh thông điệp mà component CLIENT của nhóm route dùng (next-intl mặc định
 * tuần tự hoá TOÀN BỘ ~100 KB thông điệp vào mỗi trang). Đường dẫn dạng `ns` hoặc `ns.sub.key`; component server (getTranslations,
 * useTranslations trong RSC) vẫn đọc đủ thông điệp từ request config. Thiếu nhánh → next-intl báo MISSING_MESSAGE (e2e bắt được).
 */
export function pickMessages(all: AbstractIntlMessages, paths: readonly string[]): AbstractIntlMessages {
  const out: AbstractIntlMessages = {};
  for (const path of paths) {
    const keys = path.split('.');
    let src: unknown = all;
    for (const k of keys) src = src && typeof src === 'object' ? (src as Record<string, unknown>)[k] : undefined;
    if (src === undefined) continue;
    let dst = out as Record<string, unknown>;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) dst[k] = src;
      else dst = (dst[k] = dst[k] && typeof dst[k] === 'object' ? dst[k] : {}) as Record<string, unknown>;
    });
  }
  return out;
}

/** Ngoài nhóm route (offline, cổng thanh toán giả, not-found, lớp gốc: logo, banner cài đặt PWA) */
export const ROOT_MESSAGES = ['common', 'offline', 'pwa', 'errors'] as const;
/** Nhóm (marketing): header/footer, đồng ý cookie, landing + câu mẫu, đăng nhập/đăng ký/giới thiệu, đăng ký chờ */
export const MARKETING_MESSAGES = ['common', 'nav', 'settings.locales', 'landing', 'programs', 'auth', 'errors', 'consent', 'referral.landing', 'marketing.waitlist', 'attempt.optionLabel'] as const;
