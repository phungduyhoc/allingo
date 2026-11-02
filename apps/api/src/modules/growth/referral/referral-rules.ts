import { REFERRAL_DEFAULTS, referralConfigSchema, type ReferralConfig, type ReferralStage } from '@allingo/schemas';

/**
 * Quy tắc referral (Sprint 8) – thuần, không I/O: cấu hình (feature flag `ff.growth.referral.rules.config` → mặc định),
 * phát hiện lạm dụng lúc đăng ký, quyết định thưởng từng mốc (started / upgraded).
 */
export type BlockReason = 'self_referral' | 'duplicate_device' | 'duplicate_ip';
export type SkipReason = 'email_unverified' | 'monthly_cap' | 'disabled' | 'blocked';

/** Gộp cấu hình từ cờ với mặc định (giá trị sai kiểu → mặc định) */
export function resolveReferralConfig(raw: unknown): ReferralConfig {
  const c = (raw ?? {}) as Partial<ReferralConfig> & { rewards?: Partial<ReferralConfig['rewards']> };
  const merged = {
    ...REFERRAL_DEFAULTS,
    ...c,
    rewards: {
      started: { ...REFERRAL_DEFAULTS.rewards.started, ...(c.rewards?.started ?? {}) },
      upgraded: { ...REFERRAL_DEFAULTS.rewards.upgraded, ...(c.rewards?.upgraded ?? {}) },
    },
  };
  const parsed = referralConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : REFERRAL_DEFAULTS;
}

/**
 * Lạm dụng lúc đăng ký (trong cửa sổ `windowHours`, mặc định 24 giờ):
 *  - self_referral: thiết bị (fingerprint băm) hoặc IP của người được giới thiệu trùng phiên gần đây của người giới thiệu
 *  - duplicate_device: cùng fingerprint với một lượt giới thiệu khác (bất kỳ người giới thiệu) trong cửa sổ
 *  - duplicate_ip: cùng IP với lượt giới thiệu khác CỦA CÙNG người giới thiệu trong cửa sổ (không áp toàn hệ thống – NAT trường học)
 */
export function detectReferralAbuse(input: {
  refereeFp: string | null;
  refereeIp: string | null;
  referrerSignals: { fingerprints: string[]; ips: string[] };
  recentSameFp: number;
  recentSameReferrerIp: number;
}): BlockReason | null {
  if ((input.refereeFp && input.referrerSignals.fingerprints.includes(input.refereeFp)) || (input.refereeIp && input.referrerSignals.ips.includes(input.refereeIp))) return 'self_referral';
  if (input.refereeFp && input.recentSameFp > 0) return 'duplicate_device';
  if (input.refereeIp && input.recentSameReferrerIp > 0) return 'duplicate_ip';
  return null;
}

/**
 * Thưởng một mốc: đã thưởng → không; cờ tắt → disabled; bị chặn → blocked; chưa xác minh (người được giới thiệu, và người giới
 * thiệu) → email_unverified (cấp bù ở mốc sau khi đã xác minh); người giới thiệu đã nhận ≥ monthly_cap lần trong tháng → monthly_cap
 * (cả hai bên không thưởng mốc này).
 */
export function referralRewardDecision(input: {
  stage: ReferralStage;
  alreadyCredited: boolean;
  enabled: boolean;
  blockedReason: string | null;
  refereeVerified: boolean;
  referrerVerified: boolean;
  config: ReferralConfig;
  referrerRewardsThisMonth: number;
}): { grant: true; referrer: number; referee: number } | { grant: false; reason: SkipReason | 'already_credited' } {
  if (input.alreadyCredited) return { grant: false, reason: 'already_credited' };
  if (!input.enabled) return { grant: false, reason: 'disabled' };
  if (input.blockedReason) return { grant: false, reason: 'blocked' };
  if (input.config.require_verified_email && (!input.refereeVerified || !input.referrerVerified)) return { grant: false, reason: 'email_unverified' };
  if (input.referrerRewardsThisMonth >= input.config.monthly_cap) return { grant: false, reason: 'monthly_cap' };
  const r = input.config.rewards[input.stage];
  return { grant: true, referrer: r.referrer, referee: r.referee };
}

/** Lý do bỏ qua được thử lại ở sự kiện sau (cấp bù) */
export function isRetryableSkip(reason: string | undefined): boolean {
  return reason === 'email_unverified' || reason === 'disabled';
}

/** Che tên hiển thị: "Nguyễn Văn A" → "Ng***" */
export function maskName(name: string | null | undefined): string {
  const s = (name ?? '').trim();
  if (!s) return '***';
  return `${[...s].slice(0, 2).join('')}***`;
}
