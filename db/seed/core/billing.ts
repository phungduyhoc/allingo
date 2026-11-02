import { sql } from 'drizzle-orm';
import type { Db } from '../../src/client.js';
import {
  billingFeatureFlags,
  billingPlans,
  billingPrices,
  billingPromotions,
  billingQuotas,
  iamRoles,
  learnBadges,
} from '../../drizzle/schema/index.js';
import { DEFAULT_QUOTAS, FEATURE_CODES } from '@allingo/schemas';

/** Gói & giá theo PRD mục 4 (VND). Giá là số tạm cho dev/beta, chỉnh trong admin trước khi bán. */
type PlanSeed = {
  code: string;
  kind: 'free' | 'monthly' | 'yearly' | 'lifetime' | 'combo' | 'credit_pack';
  programs: string[];
  name: { vi: string; en: string };
  description?: { vi: string; en: string };
  creditsIncluded: number;
  creditsPeriod: 'monthly' | 'once' | null;
  durationDays: number | null;
  features: Record<string, unknown>;
  sortOrder: number;
  price: { amount: number; compareAt?: number } | null;
};

const PRO_FEATURES = {
  [FEATURE_CODES.FULL_TEST]: true,
  [FEATURE_CODES.MINI_TEST]: true,
  [FEATURE_CODES.PART_DRILL]: true,
  [FEATURE_CODES.AI_EXPLAIN]: true,
  [FEATURE_CODES.AI_TUTOR]: true,
  [FEATURE_CODES.AI_DIAGNOSE]: true,
  [FEATURE_CODES.GRADE_WRITING]: true,
  [FEATURE_CODES.GRADE_SPEAKING]: true,
  [FEATURE_CODES.DICTIONARY_AI]: true,
  [FEATURE_CODES.SHADOWING]: true,
  [FEATURE_CODES.STUDY_PLAN]: true,
  [FEATURE_CODES.SRS_NEW_CARDS]: true,
  [FEATURE_CODES.STREAK_FREEZE]: true,
};
const FREE_FEATURES = {
  [FEATURE_CODES.FULL_TEST]: true,
  [FEATURE_CODES.MINI_TEST]: true,
  [FEATURE_CODES.PART_DRILL]: true,
  [FEATURE_CODES.AI_EXPLAIN]: true,
  [FEATURE_CODES.AI_TUTOR]: true,
  [FEATURE_CODES.DICTIONARY_AI]: true,
  [FEATURE_CODES.STUDY_PLAN]: true,
  [FEATURE_CODES.SRS_NEW_CARDS]: true,
};

const perProgram = (program: string, label: string, idx: number): PlanSeed[] => [
  {
    code: `${program}_pro_monthly`,
    kind: 'monthly',
    programs: [program],
    name: { vi: `${label} Pro – Tháng`, en: `${label} Pro – Monthly` },
    creditsIncluded: 5000,
    creditsPeriod: 'monthly',
    durationDays: 30,
    features: PRO_FEATURES,
    sortOrder: idx * 10 + 1,
    price: { amount: 199_000 },
  },
  {
    code: `${program}_pro_yearly`,
    kind: 'yearly',
    programs: [program],
    name: { vi: `${label} Pro – Năm`, en: `${label} Pro – Yearly` },
    creditsIncluded: 5000,
    creditsPeriod: 'monthly',
    durationDays: 365,
    features: PRO_FEATURES,
    sortOrder: idx * 10 + 2,
    price: { amount: 1_490_000, compareAt: 2_388_000 },
  },
  {
    code: `${program}_pro_lifetime`,
    kind: 'lifetime',
    programs: [program],
    name: { vi: `${label} Pro – Trọn đời`, en: `${label} Pro – Lifetime` },
    creditsIncluded: 70_000,
    creditsPeriod: 'once',
    durationDays: null,
    features: PRO_FEATURES,
    sortOrder: idx * 10 + 3,
    price: { amount: 2_990_000 },
  },
];

export const PLANS: PlanSeed[] = [
  {
    code: 'free',
    kind: 'free',
    programs: [],
    name: { vi: 'Miễn phí', en: 'Free' },
    description: {
      vi: 'Luyện đề giới hạn, 300 credit AI mỗi tháng (≈10 giải thích/ngày)',
      en: 'Limited practice, 300 AI credits per month (≈10 explanations/day)',
    },
    creditsIncluded: 300,
    creditsPeriod: 'monthly',
    durationDays: null,
    features: FREE_FEATURES,
    sortOrder: 0,
    price: null,
  },
  ...perProgram('toeic', 'TOEIC', 1),
  ...perProgram('ielts', 'IELTS', 2),
  ...perProgram('jlpt', 'JLPT', 3),
  ...perProgram('hsk', 'HSK', 4),
  {
    code: 'combo_all_yearly',
    kind: 'combo',
    programs: ['toeic', 'ielts', 'jlpt', 'hsk'],
    name: { vi: 'Combo 4 chương trình – Năm', en: 'All-programs Combo – Yearly' },
    creditsIncluded: 8000,
    creditsPeriod: 'monthly',
    durationDays: 365,
    features: PRO_FEATURES,
    sortOrder: 50,
    price: { amount: 2_490_000, compareAt: 5_960_000 },
  },
  {
    code: 'credits_1000',
    kind: 'credit_pack',
    programs: [],
    name: { vi: 'Gói 1.000 credit', en: '1,000 credits' },
    creditsIncluded: 1000,
    creditsPeriod: 'once',
    durationDays: null,
    features: {},
    sortOrder: 60,
    price: { amount: 49_000 },
  },
  {
    code: 'credits_5000',
    kind: 'credit_pack',
    programs: [],
    name: { vi: 'Gói 5.000 credit', en: '5,000 credits' },
    creditsIncluded: 5000,
    creditsPeriod: 'once',
    durationDays: null,
    features: {},
    sortOrder: 61,
    price: { amount: 199_000 },
  },
];

const ROLES = [
  { code: 'learner', description: 'Người học' },
  { code: 'teacher', description: 'Giáo viên duyệt nội dung / chấm' },
  { code: 'editor', description: 'Biên tập nội dung' },
  { code: 'admin', description: 'Quản trị vận hành' },
  { code: 'superadmin', description: 'Quản trị hệ thống' },
  { code: 'org_admin', description: 'Quản trị tổ chức B2B' },
  { code: 'service', description: 'Tài khoản dịch vụ nội bộ (job/relay)' },
];

const BADGES = [
  {
    code: 'first_attempt',
    name: { vi: 'Bài đầu tiên', en: 'First attempt' },
    rule: { event: 'attempt.graded', count: 1 },
  },
  { code: 'streak_7', name: { vi: '7 ngày liên tiếp', en: '7-day streak' }, rule: { streak: 7 } },
  { code: 'streak_30', name: { vi: '30 ngày liên tiếp', en: '30-day streak' }, rule: { streak: 30 } },
  { code: 'questions_1000', name: { vi: '1.000 câu hỏi', en: '1,000 questions' }, rule: { answered: 1000 } },
  {
    code: 'first_full_test',
    name: { vi: 'Đề thi thử đầu tiên', en: 'First full test' },
    rule: { event: 'attempt.graded', kind: 'full', count: 1 },
  },
  { code: 'score_up_50', name: { vi: 'Tăng 50 điểm', en: '+50 points' }, rule: { score_delta: 50 } },
];

const FLAGS: Array<{ key: string; enabled: boolean; rules?: Record<string, unknown> }> = [
  { key: 'ff.ai.explain', enabled: true },
  { key: 'ff.ai.tutor', enabled: true },
  { key: 'ff.ai.diagnose', enabled: false },
  // S7: checkout bật mặc định cho DB mới (seed onConflictDoNothing – DB đã có giữ giá trị hiện tại); tắt bằng PUT /admin/flags
  { key: 'ff.billing.checkout', enabled: true },
  { key: 'ff.growth.referral', enabled: false },
  { key: 'ff.growth.beta_gate', enabled: false },
  { key: 'ff.learning.study_plan', enabled: false },
  { key: 'ff.catalog.program.ielts', enabled: false },
  { key: 'ff.catalog.program.jlpt', enabled: false },
  { key: 'ff.catalog.program.hsk', enabled: false },
];

/**
 * Mã khuyến mãi cố định S7 (POST /promotions/validate, POST /orders). Chỉ validate điều kiện cơ bản; S8 làm đầy đủ.
 * `plans`: mã gói áp dụng (rỗng = mọi gói). Seed cập nhật định nghĩa nhưng KHÔNG đặt lại `used_count`.
 */
export const PROMOTIONS: Array<{ code: string; kind: 'percent' | 'amount'; value: number; plans: string[]; validFrom: string; validTo: string; maxUses: number | null; perUserLimit: number }> = [
  { code: 'WELCOME10', kind: 'percent', value: 10, plans: [], validFrom: '2026-01-01T00:00:00+07:00', validTo: '2028-01-01T00:00:00+07:00', maxUses: 10_000, perUserLimit: 1 },
  { code: 'TOEIC50K', kind: 'amount', value: 50_000, plans: ['toeic_pro_monthly', 'toeic_pro_yearly', 'toeic_pro_lifetime'], validFrom: '2026-01-01T00:00:00+07:00', validTo: '2028-01-01T00:00:00+07:00', maxUses: 1000, perUserLimit: 1 },
  { code: 'YEARLY20', kind: 'percent', value: 20, plans: ['toeic_pro_yearly', 'ielts_pro_yearly', 'jlpt_pro_yearly', 'hsk_pro_yearly', 'combo_all_yearly'], validFrom: '2026-01-01T00:00:00+07:00', validTo: '2028-01-01T00:00:00+07:00', maxUses: null, perUserLimit: 2 },
  { code: 'EXPIRED2025', kind: 'percent', value: 30, plans: [], validFrom: '2025-01-01T00:00:00+07:00', validTo: '2026-01-01T00:00:00+07:00', maxUses: null, perUserLimit: 1 },
];

export async function seedBilling(db: Db): Promise<void> {
  await db
    .insert(iamRoles)
    .values(ROLES)
    .onConflictDoUpdate({ target: iamRoles.code, set: { description: sql`excluded.description` } });

  const planRows = await db
    .insert(billingPlans)
    .values(
      PLANS.map((p) => ({
        code: p.code,
        kind: p.kind,
        programCodes: p.programs,
        name: p.name,
        description: p.description ?? null,
        creditsIncluded: p.creditsIncluded,
        creditsPeriod: p.creditsPeriod,
        durationDays: p.durationDays,
        features: p.features,
        isActive: true,
        sortOrder: p.sortOrder,
      })),
    )
    .onConflictDoUpdate({
      target: billingPlans.code,
      set: {
        kind: sql`excluded.kind`,
        programCodes: sql`excluded.program_codes`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        creditsIncluded: sql`excluded.credits_included`,
        creditsPeriod: sql`excluded.credits_period`,
        durationDays: sql`excluded.duration_days`,
        features: sql`excluded.features`,
        sortOrder: sql`excluded.sort_order`,
      },
    })
    .returning({ id: billingPlans.id, code: billingPlans.code });
  const planId = new Map(planRows.map((r) => [r.code, r.id]));

  // Giá: một bản ghi VND/VN hiệu lực hiện tại cho mỗi gói có giá; idempotent theo (plan_id, currency, region, valid_from = epoch)
  const validFrom = new Date('2026-01-01T00:00:00Z');
  for (const p of PLANS) {
    if (!p.price) continue;
    const id = planId.get(p.code)!;
    const existing = await db
      .select({ id: billingPrices.id })
      .from(billingPrices)
      .where(
        sql`${billingPrices.planId} = ${id} AND ${billingPrices.currency} = 'VND' AND ${billingPrices.region} = 'VN'`,
      )
      .limit(1);
    if (existing.length === 0) {
      await db
        .insert(billingPrices)
        .values({
          planId: id,
          currency: 'VND',
          amount: String(p.price.amount),
          compareAt: p.price.compareAt ? String(p.price.compareAt) : null,
          region: 'VN',
          validFrom,
        });
    } else {
      await db
        .update(billingPrices)
        .set({ amount: String(p.price.amount), compareAt: p.price.compareAt ? String(p.price.compareAt) : null })
        .where(sql`${billingPrices.id} = ${existing[0]!.id}`);
    }
  }

  for (const p of PROMOTIONS) {
    const planIds = p.plans.map((c) => planId.get(c)).filter((x): x is string => !!x);
    const values = {
      code: p.code,
      kind: p.kind,
      value: String(p.value),
      planIds: planIds.length ? planIds : null,
      validFrom: new Date(p.validFrom),
      validTo: new Date(p.validTo),
      maxUses: p.maxUses,
      perUserLimit: p.perUserLimit,
      isActive: true,
    };
    await db
      .insert(billingPromotions)
      .values(values)
      .onConflictDoUpdate({
        target: billingPromotions.code,
        set: { kind: values.kind, value: values.value, planIds: values.planIds, validFrom: values.validFrom, validTo: values.validTo, maxUses: values.maxUses, perUserLimit: values.perUserLimit },
      });
  }

  await db
    .insert(billingQuotas)
    .values(
      DEFAULT_QUOTAS.map((q) => ({
        planKind: q.plan_kind,
        featureCode: q.feature,
        period: q.period,
        limitValue: q.limit,
      })),
    )
    .onConflictDoUpdate({
      target: [billingQuotas.planKind, billingQuotas.featureCode, billingQuotas.period],
      set: { limitValue: sql`excluded.limit_value` },
    });

  await db
    .insert(learnBadges)
    .values(BADGES)
    .onConflictDoUpdate({ target: learnBadges.code, set: { name: sql`excluded.name`, rule: sql`excluded.rule` } });

  await db
    .insert(billingFeatureFlags)
    .values(FLAGS.map((f) => ({ key: f.key, enabled: f.enabled, rules: f.rules ?? {} })))
    .onConflictDoNothing();
}
