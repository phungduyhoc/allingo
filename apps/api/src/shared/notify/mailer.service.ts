import { Global, Inject, Injectable, Module } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV, type Env } from '../../config/env.js';
import { getLogger } from '../telemetry/logger.js';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** S8: tệp đính kèm (PDF hoá đơn) */
  attachments?: MailAttachment[];
  /** S8: header bổ sung (List-Unsubscribe, List-Unsubscribe-Post – RFC 8058) */
  headers?: Record<string, string>;
  /** S8: thẻ phân loại cho nhà cung cấp (Resend tags) – không chứa PII */
  tags?: Record<string, string>;
}

export type EmailProviderKind = 'smtp' | 'ses' | 'resend' | 'memory';

/** Adapter gửi email (S8): SMTP (Mailpit dev / máy chủ SMTP), Amazon SES (giao diện SMTP), Resend (HTTP API), bộ nhớ (test) */
export interface EmailProvider {
  readonly kind: EmailProviderKind;
  send(msg: MailMessage, from: string, replyTo?: string): Promise<void>;
}

/** HTTP tối giản (fetch) – test thay bằng HTTP giả */
export type MailHttpClient = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;

export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter | null = null;
  constructor(
    readonly kind: 'smtp' | 'ses',
    private readonly opts: { host: string; port: number; user?: string; pass?: string },
  ) {}

  private transport(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.opts.host,
        port: this.opts.port,
        secure: this.opts.port === 465,
        auth: this.opts.user ? { user: this.opts.user, pass: this.opts.pass ?? '' } : undefined,
        connectionTimeout: 5000,
      });
    }
    return this.transporter;
  }

  async send(msg: MailMessage, from: string, replyTo?: string): Promise<void> {
    await this.transport().sendMail({ from, to: msg.to, replyTo, subject: msg.subject, text: msg.text, html: msg.html, headers: msg.headers, attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) });
  }
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email) – POST /emails, Bearer API key; đính kèm base64 */
export class ResendEmailProvider implements EmailProvider {
  readonly kind = 'resend' as const;
  constructor(
    private readonly opts: { apiKey: string; baseUrl: string },
    private readonly http: MailHttpClient = defaultMailHttp,
  ) {}

  /** Thân request (tách riêng để test) */
  static body(msg: MailMessage, from: string, replyTo?: string): Record<string, unknown> {
    return {
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })) } : {}),
      ...(msg.tags ? { tags: Object.entries(msg.tags).map(([name, value]) => ({ name, value: value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) })) } : {}),
    };
  }

  async send(msg: MailMessage, from: string, replyTo?: string): Promise<void> {
    const res = await this.http(`${this.opts.baseUrl.replace(/\/+$/, '')}/emails`, { method: 'POST', headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(ResendEmailProvider.body(msg, from, replyTo)) });
    if (res.status < 200 || res.status >= 300) throw new Error(`resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export class MemoryEmailProvider implements EmailProvider {
  readonly kind = 'memory' as const;
  constructor(private readonly sink: MailMessage[]) {}
  async send(msg: MailMessage): Promise<void> {
    this.sink.push(msg);
  }
}

const defaultMailHttp: MailHttpClient = async (url, init) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    return { status: r.status, text: () => r.text() };
  } finally {
    clearTimeout(t);
  }
};

/** Chọn adapter theo EMAIL_PROVIDER (auto: test hoặc OTP_SENDER=memory → bộ nhớ; còn lại SMTP) */
export function resolveEmailProvider(env: Env, sink: MailMessage[]): EmailProvider {
  const kind = env.EMAIL_PROVIDER === 'auto' ? (env.APP_ENV === 'test' || env.OTP_SENDER === 'memory' ? 'memory' : 'smtp') : env.EMAIL_PROVIDER;
  switch (kind) {
    case 'memory':
      return new MemoryEmailProvider(sink);
    case 'resend':
      if (!env.RESEND_API_KEY) throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY');
      return new ResendEmailProvider({ apiKey: env.RESEND_API_KEY, baseUrl: env.RESEND_API_URL });
    case 'ses':
      if (!env.SES_SMTP_USER || !env.SES_SMTP_PASS) throw new Error('EMAIL_PROVIDER=ses requires SES_SMTP_USER and SES_SMTP_PASS');
      return new SmtpEmailProvider('ses', { host: `email-smtp.${env.SES_REGION}.amazonaws.com`, port: 587, user: env.SES_SMTP_USER, pass: env.SES_SMTP_PASS });
    default:
      return new SmtpEmailProvider('smtp', { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS });
  }
}

/**
 * Gửi email (OTP S1, thông báo đa kênh S8) qua adapter EMAIL_PROVIDER. APP_ENV=test hoặc OTP_SENDER=memory → giữ trong bộ nhớ
 * để test đọc lại. Không log địa chỉ email (CLAUDE.md §9) – chỉ log chủ đề + loại adapter.
 */
@Injectable()
export class MailerService {
  private readonly logger = getLogger({ component: 'mailer' });
  /** Hộp thư trong bộ nhớ (test) */
  readonly outbox: MailMessage[] = [];
  readonly memoryMode: boolean;
  private provider: EmailProvider;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.provider = resolveEmailProvider(env, this.outbox);
    this.memoryMode = this.provider.kind === 'memory';
  }

  get providerKind(): EmailProviderKind {
    return this.provider.kind;
  }

  /** Thay adapter (test: HTTP giả cho Resend) */
  setProvider(p: EmailProvider): void {
    this.provider = p;
  }

  async send(msg: MailMessage): Promise<{ delivered: boolean; error?: string }> {
    try {
      await this.provider.send(msg, this.env.SMTP_FROM, this.env.EMAIL_REPLY_TO);
      return { delivered: true };
    } catch (err) {
      const message = (err as Error).message.slice(0, 200);
      this.logger.warn({ err: message, subject: msg.subject, provider: this.provider.kind }, 'email send failed');
      return { delivered: false, error: message };
    }
  }

  /** Thư gần nhất gửi tới địa chỉ (chỉ test/memory) */
  lastTo(to: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to.toLowerCase() === to.toLowerCase());
  }

  /** Mọi thư gửi tới địa chỉ (chỉ test/memory) */
  allTo(to: string): MailMessage[] {
    return this.outbox.filter((m) => m.to.toLowerCase() === to.toLowerCase());
  }
}

@Global()
@Module({ providers: [MailerService], exports: [MailerService] })
export class NotifyModule {}
