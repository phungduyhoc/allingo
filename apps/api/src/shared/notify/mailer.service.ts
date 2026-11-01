import { Global, Inject, Injectable, Module } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV, type Env } from '../../config/env.js';
import { getLogger } from '../telemetry/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Gửi email qua SMTP (dev: Mailpit :1025). APP_ENV=test hoặc OTP_SENDER=memory → giữ trong bộ nhớ để test đọc lại.
 * Không log địa chỉ email (CLAUDE.md §9) – chỉ log chủ đề.
 */
@Injectable()
export class MailerService {
  private readonly logger = getLogger({ component: 'mailer' });
  private transporter: Transporter | null = null;
  /** Hộp thư trong bộ nhớ (test) */
  readonly outbox: MailMessage[] = [];
  readonly memoryMode: boolean;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.memoryMode = env.APP_ENV === 'test' || env.OTP_SENDER === 'memory';
  }

  private transport(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.env.SMTP_HOST,
        port: this.env.SMTP_PORT,
        secure: this.env.SMTP_PORT === 465,
        auth: this.env.SMTP_USER ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASS ?? '' } : undefined,
        connectionTimeout: 5000,
      });
    }
    return this.transporter;
  }

  async send(msg: MailMessage): Promise<{ delivered: boolean }> {
    if (this.memoryMode) {
      this.outbox.push(msg);
      return { delivered: true };
    }
    try {
      await this.transport().sendMail({ from: this.env.SMTP_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
      return { delivered: true };
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, subject: msg.subject }, 'smtp send failed');
      return { delivered: false };
    }
  }

  /** Thư gần nhất gửi tới địa chỉ (chỉ test/memory) */
  lastTo(to: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to.toLowerCase() === to.toLowerCase());
  }
}

@Global()
@Module({ providers: [MailerService], exports: [MailerService] })
export class NotifyModule {}
