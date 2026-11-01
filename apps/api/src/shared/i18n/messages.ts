/**
 * Thông điệp hệ thống tối thiểu (email, thông báo) theo locale. UI dịch mã lỗi phía client;
 * API chỉ trả `code` + message tiếng Anh ngắn.
 */
export const SYSTEM_MESSAGES = {
  vi: { guest_display_name: 'Khách', welcome_subject: 'Chào mừng bạn đến với Allingo' },
  en: { guest_display_name: 'Guest', welcome_subject: 'Welcome to Allingo' },
} as const;

export type SystemLocale = keyof typeof SYSTEM_MESSAGES;
export const t = (locale: string, key: keyof (typeof SYSTEM_MESSAGES)['vi']): string => (SYSTEM_MESSAGES[(locale as SystemLocale) in SYSTEM_MESSAGES ? (locale as SystemLocale) : 'vi'] ?? SYSTEM_MESSAGES.vi)[key];
