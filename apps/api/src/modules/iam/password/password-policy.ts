import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env.js';
import { ValidationFailed } from '../../../shared/http/errors.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { BASE_WORDS, COMMON_PASSWORDS } from './common-passwords.js';

export type PasswordIssue = 'password_too_short' | 'password_breached' | 'password_weak';

const COMMON = new Set(COMMON_PASSWORDS.map((p) => p.toLowerCase()));
const BASES = new Set(BASE_WORDS);
/** Hậu tố số/ký hiệu sau từ gốc (≤ 6 ký tự) – "123", "@2026", "!", "1234!" */
const SUFFIX_RE = /^(.*?)([0-9!@#$%^&*._\-+=?~]{0,6})$/;
const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/**
 * Kiểm tra chính sách mật khẩu (thuần, S12 – pentest-1): độ dài tối thiểu, danh sách lộ offline, biến thể "từ gốc + số/ký hiệu",
 * chuỗi một ký tự lặp / dãy liên tiếp, chứa email/tên hiển thị. Trả mã lỗi đầu tiên hoặc null.
 */
export function checkPasswordPolicy(password: string, opts: { minLength: number; breachCheck?: boolean; context?: Array<string | null | undefined> }): PasswordIssue | null {
  if ([...password].length < opts.minLength) return 'password_too_short';
  if (opts.breachCheck === false) return null;
  const lower = password.trim().toLowerCase();
  if (COMMON.has(lower)) return 'password_breached';
  const m = SUFFIX_RE.exec(lower);
  const base = m?.[1] ?? lower;
  if (BASES.has(base) || COMMON.has(base)) return 'password_breached';
  // Một ký tự lặp (aaaaaaaaaaaa) hoặc một dãy bàn phím/chữ số liên tiếp (xuôi/ngược)
  if (new Set(lower).size <= 2) return 'password_weak';
  const compact = lower.replace(/[^a-z0-9]/g, '');
  if (compact.length >= opts.minLength - 2 && SEQUENCES.some((s) => s.includes(compact) || [...s].reverse().join('').includes(compact))) return 'password_weak';
  // Chứa phần trước @ của email hoặc tên hiển thị (≥ 4 ký tự) và phần còn lại ngắn
  for (const c of opts.context ?? []) {
    const token = (c ?? '').toLowerCase().split('@')[0]!.replace(/\s+/g, '');
    if (token.length >= 4 && lower.replace(/\s+/g, '').includes(token) && lower.length - token.length < 6) return 'password_weak';
  }
  return null;
}

export type HibpFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Chính sách mật khẩu cho đăng ký (và đặt/đổi mật khẩu sau này): offline luôn chạy; HIBP Pwned Passwords k-anonymity tuỳ chọn
 * (PASSWORD_HIBP_ENABLED) – chỉ gửi 5 ký tự đầu SHA-1, header Add-Padding; lỗi mạng/timeout → bỏ qua (fail-open, log cảnh báo).
 */
@Injectable()
export class PasswordPolicyService {
  private readonly logger = getLogger({ component: 'iam.password' });
  private fetcher: HibpFetch = (url, init) => fetch(url, init);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Test thay HTTP giả */
  setFetcher(f: HibpFetch): void {
    this.fetcher = f;
  }

  async assertAcceptable(password: string, context: Array<string | null | undefined> = []): Promise<void> {
    let issue = checkPasswordPolicy(password, { minLength: this.env.PASSWORD_MIN_LENGTH, breachCheck: this.env.PASSWORD_BREACH_CHECK, context });
    if (!issue && this.env.PASSWORD_HIBP_ENABLED && (await this.pwnedCount(password)) > 0) issue = 'password_breached';
    if (issue) throw new ValidationFailed({ issues: [{ path: 'password', code: issue, message: issueMessage(issue, this.env.PASSWORD_MIN_LENGTH) }], min_length: this.env.PASSWORD_MIN_LENGTH }, 'Password does not meet the policy');
  }

  /** Số lần xuất hiện trong HIBP (0 = không thấy hoặc không gọi được) */
  async pwnedCount(password: string): Promise<number> {
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.env.PASSWORD_HIBP_TIMEOUT_MS);
    try {
      const res = await this.fetcher(`${this.env.PASSWORD_HIBP_URL.replace(/\/+$/, '')}/${prefix}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'allingo-api' }, signal: ctrl.signal });
      if (!res.ok) {
        this.logger.warn({ status: res.status }, 'hibp lookup failed (fail-open)');
        return 0;
      }
      for (const line of (await res.text()).split('\n')) {
        const [suf, count] = line.trim().split(':');
        if (suf === suffix) return Number(count) || 0;
      }
      return 0;
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'hibp lookup error (fail-open)');
      return 0;
    } finally {
      clearTimeout(timer);
    }
  }
}

function issueMessage(issue: PasswordIssue, min: number): string {
  if (issue === 'password_too_short') return `password must be at least ${min} characters`;
  if (issue === 'password_breached') return 'password appears in a list of breached or common passwords';
  return 'password is too easy to guess';
}
