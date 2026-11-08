import { createHash, randomInt } from 'node:crypto';
import { BETA_DEFAULTS, BETA_TESTER_ROLE } from '@allingo/schemas';

/** Cấu hình beta hiệu lực = BETA_DEFAULTS ghi đè bởi `rules.config` của `ff.growth.beta_gate` (giá trị sai kiểu bị bỏ qua) */
export interface BetaConfig {
  trial_days: number;
  credits: number;
  daily_invite_limit: number;
  invite_ttl_days: number;
  program: string;
  credit_valid_days: number;
}

export function resolveBetaConfig(config: Record<string, unknown> | undefined | null): BetaConfig {
  const c = config ?? {};
  const num = (k: keyof BetaConfig, min: number, max: number): number => {
    const v = c[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : (BETA_DEFAULTS[k] as number);
  };
  return {
    trial_days: num('trial_days', 1, 365),
    credits: num('credits', 0, 100_000),
    daily_invite_limit: num('daily_invite_limit', 0, 10_000),
    invite_ttl_days: num('invite_ttl_days', 1, 365),
    program: typeof c.program === 'string' && /^[a-z]+$/.test(c.program) ? c.program : BETA_DEFAULTS.program,
    credit_valid_days: num('credit_valid_days', 1, 3650),
  };
}

/** Vai trò luôn qua beta gate (nội bộ + tester đã đổi mã) */
export const BETA_BYPASS_ROLES = ['admin', 'superadmin', 'teacher', 'editor', 'service', BETA_TESTER_ROLE] as const;

export type BetaAccessReason = 'gate_off' | 'role' | 'invite' | 'allowlist' | 'none';

/**
 * Quyết định beta gate (thuần – unit test ma trận): gate tắt → cho qua; vai trò bypass (JWT) → qua; allowlist `rules.user_ids`
 * → qua; đã đổi mã (vai trò beta_tester trong DB – JWT có thể chưa làm mới) → qua; còn lại → chặn.
 */
export function betaAccessDecision(input: { gateEnabled: boolean; roles: readonly string[]; allowlisted: boolean; redeemed: boolean }): { allowed: boolean; reason: BetaAccessReason } {
  if (!input.gateEnabled) return { allowed: true, reason: 'gate_off' };
  if (input.roles.some((r) => (BETA_BYPASS_ROLES as readonly string[]).includes(r))) return { allowed: true, reason: 'role' };
  if (input.allowlisted) return { allowed: true, reason: 'allowlist' };
  if (input.redeemed) return { allowed: true, reason: 'invite' };
  return { allowed: false, reason: 'none' };
}

/** Bảng chữ không gây nhầm (bỏ 0/O, 1/I/L) – mã `ALG-XXXX-XXXX` ≈ 41 bit */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateInviteCode(): string {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!;
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `ALG-${group()}-${group()}`;
}

/** Chuẩn hoá: viết hoa, bỏ khoảng trắng/gạch; thêm tiền tố ALG nếu người dùng gõ thiếu */
export function normalizeInviteCode(code: string): string {
  const s = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.startsWith('ALG') ? s : `ALG${s}`;
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(`beta-invite:${normalizeInviteCode(code)}`).digest('hex');
}

/** Đầu ngày theo giờ VN (UTC+7) */
export function vnDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 7 * 3_600_000);
}

/** Hạn mức còn lại hôm nay */
export function remainingInvites(limit: number, sentToday: number, requested?: number): number {
  const left = Math.max(0, limit - sentToday);
  return requested === undefined ? left : Math.min(left, Math.max(0, requested));
}
