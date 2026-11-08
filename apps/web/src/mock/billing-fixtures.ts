import type { PromotionConditions, PromotionKind } from '@allingo/schemas/api/billing';
import type { Plan } from '@/lib/billing';

/**
 * Gói/giá và mã khuyến mãi giả lập (S7/S8) – bám seed `pnpm db:seed --set core` của API (cùng mã, cùng giá VND, cùng điều kiện)
 * để E2E mock và E2E API thật dùng chung kịch bản. id tất định dạng UUID v4 hợp lệ.
 */

const id = (n: number) => `5a1e0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const priceId = (n: number) => `5a1e0000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`;

const PRO_FEATURES = ['ai_tutor', 'full_test', 'mini_test', 'shadowing', 'ai_explain', 'part_drill', 'study_plan', 'ai_diagnose', 'dictionary_ai', 'grade_writing', 'srs_new_cards', 'streak_freeze', 'grade_speaking'];
const FREE_FEATURES = ['ai_tutor', 'full_test', 'mini_test', 'ai_explain', 'part_drill', 'study_plan', 'dictionary_ai', 'srs_new_cards'];
const features = (list: string[]) => Object.fromEntries(list.map((f) => [f, true]));

const NAMES: Record<string, { vi: string; en: string }> = { toeic: { vi: 'TOEIC', en: 'TOEIC' }, ielts: { vi: 'IELTS', en: 'IELTS' }, jlpt: { vi: 'JLPT', en: 'JLPT' }, hsk: { vi: 'HSK', en: 'HSK' } };

function proPlans(program: string, base: number): Plan[] {
  const n = NAMES[program]!;
  return [
    { id: id(base + 1), code: `${program}_pro_monthly`, kind: 'monthly', programs: [program], name: { vi: `${n.vi} Pro – Tháng`, en: `${n.en} Pro – Monthly` }, description: null, price: { id: priceId(base + 1), amount: 199_000, currency: 'VND', compare_at: null, valid_to: null }, credits_included: 5000, credits_period: 'monthly', duration_days: 30, features: features(PRO_FEATURES) },
    { id: id(base + 2), code: `${program}_pro_yearly`, kind: 'yearly', programs: [program], name: { vi: `${n.vi} Pro – Năm`, en: `${n.en} Pro – Yearly` }, description: null, price: { id: priceId(base + 2), amount: 1_490_000, currency: 'VND', compare_at: 2_388_000, valid_to: null }, credits_included: 5000, credits_period: 'monthly', duration_days: 365, features: features(PRO_FEATURES) },
    { id: id(base + 3), code: `${program}_pro_lifetime`, kind: 'lifetime', programs: [program], name: { vi: `${n.vi} Pro – Trọn đời`, en: `${n.en} Pro – Lifetime` }, description: null, price: { id: priceId(base + 3), amount: 2_990_000, currency: 'VND', compare_at: null, valid_to: null }, credits_included: 70_000, credits_period: 'once', duration_days: null, features: features(PRO_FEATURES) },
  ];
}

export const MOCK_PLANS: Plan[] = [
  {
    id: id(1),
    code: 'free',
    kind: 'free',
    programs: [],
    name: { vi: 'Miễn phí', en: 'Free' },
    description: { vi: 'Luyện đề giới hạn, 300 credit AI mỗi tháng (≈10 giải thích/ngày)', en: 'Limited practice, 300 AI credits per month (≈10 explanations/day)' },
    price: null,
    credits_included: 300,
    credits_period: 'monthly',
    duration_days: null,
    features: features(FREE_FEATURES),
  },
  ...proPlans('toeic', 10),
  ...proPlans('ielts', 20),
  ...proPlans('jlpt', 30),
  ...proPlans('hsk', 40),
  { id: id(50), code: 'combo_all_yearly', kind: 'combo', programs: ['toeic', 'ielts', 'jlpt', 'hsk'], name: { vi: 'Combo 4 chương trình – Năm', en: 'All-programs Combo – Yearly' }, description: null, price: { id: priceId(50), amount: 2_490_000, currency: 'VND', compare_at: 5_960_000, valid_to: null }, credits_included: 8000, credits_period: 'monthly', duration_days: 365, features: features(PRO_FEATURES) },
  { id: id(60), code: 'credits_1000', kind: 'credit_pack', programs: [], name: { vi: 'Gói 1.000 credit', en: '1,000 credits' }, description: null, price: { id: priceId(60), amount: 49_000, currency: 'VND', compare_at: null, valid_to: null }, credits_included: 1000, credits_period: 'once', duration_days: null, features: {} },
  { id: id(61), code: 'credits_5000', kind: 'credit_pack', programs: [], name: { vi: 'Gói 5.000 credit', en: '5,000 credits' }, description: null, price: { id: priceId(61), amount: 199_000, currency: 'VND', compare_at: null, valid_to: null }, credits_included: 5000, credits_period: 'once', duration_days: null, features: {} },
];

export interface MockPromotion {
  id: string;
  code: string;
  kind: PromotionKind;
  value: number;
  name: { vi?: string; en?: string } | null;
  plan_codes: string[];
  conditions: PromotionConditions;
  valid_from: string;
  valid_to: string;
  max_uses: number | null;
  per_user_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const pid = (n: number) => `5a1e0000-0000-4000-a000-${n.toString(16).padStart(12, '0')}`;
const FROM = '2025-12-31T17:00:00.000Z';
const TO = '2027-12-31T17:00:00.000Z';
const SEEDED = '2026-11-01T00:00:00.000Z';

export const MOCK_PROMOTIONS: MockPromotion[] = [
  { id: pid(1), code: 'WELCOME10', kind: 'percent', value: 10, name: null, plan_codes: [], conditions: { new_users_only: true }, valid_from: FROM, valid_to: TO, max_uses: null, per_user_limit: 1, is_active: true, created_at: SEEDED, updated_at: SEEDED },
  { id: pid(2), code: 'WELCOME20', kind: 'percent', value: 20, name: { vi: 'Chào bạn mới – giảm 20 %', en: 'Welcome – 20% off' }, plan_codes: [], conditions: { new_users_only: true }, valid_from: FROM, valid_to: TO, max_uses: 10_000, per_user_limit: 1, is_active: true, created_at: SEEDED, updated_at: SEEDED },
  { id: pid(3), code: 'TOEIC50K', kind: 'fixed', value: 50_000, name: null, plan_codes: [], conditions: { program_codes: ['toeic'] }, valid_from: FROM, valid_to: TO, max_uses: null, per_user_limit: 1, is_active: true, created_at: SEEDED, updated_at: SEEDED },
  { id: pid(4), code: 'YEARLY20', kind: 'percent', value: 20, name: null, plan_codes: [], conditions: { plan_kinds: ['yearly', 'combo'] }, valid_from: FROM, valid_to: TO, max_uses: null, per_user_limit: 1, is_active: true, created_at: SEEDED, updated_at: SEEDED },
  { id: pid(5), code: 'PRO7DAY', kind: 'trial_days', value: 7, name: { vi: 'Dùng thử Pro 7 ngày', en: '7-day Pro trial' }, plan_codes: [], conditions: {}, valid_from: FROM, valid_to: TO, max_uses: null, per_user_limit: 1, is_active: true, created_at: SEEDED, updated_at: SEEDED },
  { id: pid(6), code: 'BONUS500', kind: 'credit_bonus', value: 500, name: { vi: 'Tặng 500 credit cho gói năm', en: '500 bonus credits with yearly plans' }, plan_codes: [], conditions: { plan_kinds: ['yearly', 'combo'], credit_valid_days: 365 }, valid_from: FROM, valid_to: TO, max_uses: 5000, per_user_limit: 1, is_active: true, created_at: SEEDED, updated_at: SEEDED },
  { id: pid(7), code: 'GIFT200', kind: 'credit_bonus', value: 200, name: { vi: 'Quà tặng 200 credit', en: '200 gift credits' }, plan_codes: [], conditions: { standalone: true, credit_valid_days: 90 }, valid_from: FROM, valid_to: TO, max_uses: 1000, per_user_limit: 1, is_active: true, created_at: SEEDED, updated_at: SEEDED },
  { id: pid(8), code: 'EXPIRED2025', kind: 'percent', value: 30, name: null, plan_codes: [], conditions: {}, valid_from: '2025-01-01T00:00:00.000Z', valid_to: '2025-12-31T16:59:59.000Z', max_uses: null, per_user_limit: 1, is_active: true, created_at: SEEDED, updated_at: SEEDED },
];
