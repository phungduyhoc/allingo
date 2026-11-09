// TỰ SINH bởi `node scripts/i18n-scopes.mjs` (S11) – không sửa tay; `pnpm test` kiểm tra tệp còn khớp mã nguồn.
// Nhánh thông điệp next-intl gửi xuống trình duyệt cho khu vực học: layout (AuthGate, AppShell, realtime…) + từng trang.

export const APP_LAYOUT_MESSAGES = ["auth","badges","billing.banner","common","consent","errors","feedback","legalFooter","mfaStepUp","nav","notifications","programArea","programs","pwa","quota","settings.locales","tutor"] as const;

export const APP_PAGE_MESSAGES = {
  "(exam)/attempts/[id]": ["attempt","common","contentReport","dictionary","errors","questionTypes","quota","review","sections"],
  "(shell)/[program]/dashboard": ["common","dashboard","errorLog","errors","examLock","forecast","marketing.comingSoon","marketing.waitlist","plan","programArea","programs","quota","result.subskills","sections","stats","surveys","testSets","today","tutor"],
  "(shell)/[program]/diagnostic": ["attempt","common","diagnostic","errors","marketing.comingSoon","marketing.waitlist","programArea","programs","questionTypes","result","sections"],
  "(shell)/[program]/errors": ["common","errorLog","errors","examLock","marketing.comingSoon","marketing.waitlist","programArea","programs","result.subskills","sections"],
  "(shell)/[program]/plan": ["badges","checkin","common","errors","marketing.comingSoon","marketing.waitlist","notifications","onboarding.weekdays","plan","programArea","programs","sections"],
  "(shell)/[program]/practice": ["common","errors","marketing.comingSoon","marketing.waitlist","practice","programArea","programs","result","sections"],
  "(shell)/[program]/stats": ["common","dashboard","errorLog","errors","forecast","marketing.comingSoon","marketing.waitlist","programArea","programs","result.subskills","sections","stats"],
  "(shell)/[program]/test-sets": ["common","errors","marketing.comingSoon","marketing.waitlist","programArea","programs","quota","testSets"],
  "(shell)/[program]/today": ["badges","checkin","common","errors","marketing.comingSoon","marketing.waitlist","notifications","onboarding.weekdays","plan","programArea","programs","sections","today"],
  "(shell)/[program]/vocab/[listId]": ["common","errors","marketing.comingSoon","marketing.waitlist","programArea","programs","quota","vocab"],
  "(shell)/[program]/vocab": ["common","errors","marketing.comingSoon","marketing.waitlist","programArea","programs","quota","vocab"],
  "(shell)/[program]/vocab/review": ["common","errors","flashcards","marketing.comingSoon","marketing.waitlist","programArea","programs","quota","sections"],
  "(shell)/account/billing": ["account","checkout","common","errors"],
  "(shell)/account/orders/[id]": ["account","billing","checkout","common","errors"],
  "(shell)/account/referral": ["common","errors","referral"],
  "(shell)/admin/[section]": ["admin","adminOps","attempt","common","contentReport","contentTools","errors","feedback","questionTypes","support"],
  "(shell)/admin/billing/[[...tab]]": ["account","admin","checkout","common","errors"],
  "(shell)/admin": ["admin","adminOps","attempt","common","contentReport","contentTools","errors","feedback","questionTypes","support"],
  "(shell)/attempts/[id]/result": ["common","errors","questionTypes","quota","result","sections"],
  "(shell)/attempts/[id]/review": ["attempt","common","contentReport","dictionary","errors","examLock","notes","questionTypes","quota","review","sections","tutor"],
  "(shell)/badges": ["badges","common","errors"],
  "(shell)/checkout": ["billing","checkout","common","errors"],
  "(shell)/checkout/result": ["badges","checkout","common","errors","notifications"],
  "(shell)/lessons/[lessonId]": ["common","errors","taskContent"],
  "(shell)/notes": ["common","errors","examLock","notes"],
  "(shell)/notifications": ["common","errors","notifications","quota"],
  "(shell)/onboarding/beta": ["betaOnboarding","common","errors"],
  "(shell)/onboarding": ["common","errors","onboarding"],
  "(shell)/referral": ["common","errors","referral"],
  "(shell)/settings/notifications": ["common","errors","nav","notifications"],
  "(shell)/settings": ["account","common","errors","nav","notifications","programArea","programs","settings"],
  "(shell)/settings/security": ["common","errors","security"],
  "(shell)/support": ["common","errors","support"],
  "(shell)/support/tickets/[ticketId]": ["common","errors","support"],
  "(shell)/vocab/[listId]": ["common","errors"],
} as const satisfies Record<string, readonly string[]>;

export type AppPageKey = keyof typeof APP_PAGE_MESSAGES;
