// TỰ SINH bởi `node scripts/i18n-scopes.mjs` (S11) – không sửa tay; `pnpm test` kiểm tra tệp còn khớp mã nguồn.
// Nhánh thông điệp next-intl gửi xuống trình duyệt cho khu vực học: layout (AuthGate, AppShell, realtime…) + từng trang.

export const APP_LAYOUT_MESSAGES = ["auth","badges","billing.banner","common","consent","errors","feedback","legalFooter","mfaStepUp","nav","notifications","pwa","quota","settings.locales","tutor"] as const;

export const APP_PAGE_MESSAGES = {
  "(exam)/attempts/[id]": ["attempt","common","contentReport","dictionary","errors","questionTypes","quota","review","sections"],
  "(shell)/account/billing": ["account","checkout","common","errors"],
  "(shell)/account/orders/[id]": ["account","billing","checkout","common","errors"],
  "(shell)/account/referral": ["common","errors","referral"],
  "(shell)/admin/[section]": ["admin","adminOps","common","contentReport","errors","feedback","support"],
  "(shell)/admin/billing/[[...tab]]": ["account","admin","checkout","common","errors"],
  "(shell)/admin": ["admin","adminOps","common","contentReport","errors","feedback","support"],
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
  "(shell)/settings": ["account","common","errors","nav","notifications","settings"],
  "(shell)/settings/security": ["common","errors","security"],
  "(shell)/support": ["common","errors","support"],
  "(shell)/support/tickets/[ticketId]": ["common","errors","support"],
  "(shell)/toeic/dashboard": ["common","dashboard","errorLog","errors","examLock","forecast","plan","quota","result.subskills","sections","stats","surveys","testSets","today","tutor"],
  "(shell)/toeic/diagnostic": ["attempt","common","diagnostic","errors","questionTypes","result","sections"],
  "(shell)/toeic/errors": ["common","errorLog","errors","examLock","result.subskills","sections"],
  "(shell)/toeic/plan": ["badges","checkin","common","errors","notifications","onboarding.weekdays","plan","sections"],
  "(shell)/toeic/practice": ["common","errors","practice","result","sections"],
  "(shell)/toeic/stats": ["common","dashboard","errorLog","errors","forecast","result.subskills","sections","stats"],
  "(shell)/toeic/test-sets": ["common","errors","quota","testSets"],
  "(shell)/toeic/today": ["badges","checkin","common","errors","notifications","onboarding.weekdays","plan","sections","today"],
  "(shell)/toeic/vocab/[listId]": ["common","errors","quota","vocab"],
  "(shell)/toeic/vocab": ["common","errors","quota","vocab"],
  "(shell)/toeic/vocab/review": ["common","errors","flashcards","quota","sections"],
  "(shell)/vocab/[listId]": ["common","errors"],
} as const satisfies Record<string, readonly string[]>;

export type AppPageKey = keyof typeof APP_PAGE_MESSAGES;
