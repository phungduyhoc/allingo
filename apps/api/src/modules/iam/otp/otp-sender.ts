import type { OtpChannel } from '@allingo/schemas';
import type { MailerService } from '../../../shared/notify/mailer.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';

export interface OtpSendInput {
  channel: OtpChannel;
  /** email hoặc số điện thoại (không log) */
  target: string;
  code: string;
  ttlSeconds: number;
  locale: 'vi' | 'en';
}

export interface OtpSender {
  send(input: OtpSendInput): Promise<void>;
}

/** Giữ trong bộ nhớ – test đọc lại mã */
export class MemoryOtpSender implements OtpSender {
  readonly sent: OtpSendInput[] = [];
  async send(input: OtpSendInput): Promise<void> {
    this.sent.push(input);
  }
  last(target: string): OtpSendInput | undefined {
    return [...this.sent].reverse().find((s) => s.target === target);
  }
}

/** Dev: in mã ra log (chỉ 2 số cuối của định danh) */
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = getLogger({ component: 'otp.console' });
  async send(input: OtpSendInput): Promise<void> {
    this.logger.info({ channel: input.channel, target_tail: input.target.slice(-2), code: input.code }, 'OTP (dev console sender)');
  }
}

/** Email qua SMTP (Mailpit ở dev) */
export class EmailOtpSender implements OtpSender {
  constructor(private readonly mailer: MailerService) {}
  async send(input: OtpSendInput): Promise<void> {
    const minutes = Math.round(input.ttlSeconds / 60);
    const subject = input.locale === 'en' ? `${input.code} is your Allingo verification code` : `${input.code} là mã xác minh Allingo của bạn`;
    const text =
      input.locale === 'en'
        ? `Your Allingo verification code is ${input.code}. It expires in ${minutes} minutes. If you did not request it, ignore this email.`
        : `Mã xác minh Allingo của bạn là ${input.code}. Mã hết hạn sau ${minutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`;
    await this.mailer.send({ to: input.target, subject, text, html: `<p>${text.replace(input.code, `<strong style="font-size:20px">${input.code}</strong>`)}</p>` });
  }
}

/** SMS qua nhà cung cấp VN (eSMS) – stub Sprint 1, TODO(S8): gọi API thật, lưu message id */
export class EsmsSmsSender implements OtpSender {
  private readonly logger = getLogger({ component: 'otp.esms' });
  constructor(private readonly apiKey: string | undefined) {}
  async send(input: OtpSendInput): Promise<void> {
    if (!this.apiKey) throw new Error('ESMS_API_KEY missing');
    // TODO(S8): POST https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/ với brandname OTP
    this.logger.warn({ target_tail: input.target.slice(-2) }, 'EsmsSmsSender chưa gọi API thật (stub)');
  }
}

/** Zalo ZNS – stub Sprint 1, TODO(S8): template OTP đã duyệt, access token OA */
export class ZaloZnsSender implements OtpSender {
  private readonly logger = getLogger({ component: 'otp.zns' });
  constructor(private readonly accessToken: string | undefined) {}
  async send(input: OtpSendInput): Promise<void> {
    if (!this.accessToken) throw new Error('ZALO_ZNS_ACCESS_TOKEN missing');
    this.logger.warn({ target_tail: input.target.slice(-2) }, 'ZaloZnsSender chưa gọi API thật (stub)');
  }
}
