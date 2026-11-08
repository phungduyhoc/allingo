import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { paymentProviderCodeSchema } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { Public } from '../../shared/auth/auth.guard.js';
import { NotFound } from '../../shared/http/errors.js';
import { ZodParams } from '../../shared/http/zod.js';
import type { WebhookInput } from './payments/payment-provider.js';
import { PaymentsService } from './payments.service.js';
import { RateLimit } from '../../shared/http/rate-limit.js';

const providerParam = z.object({ provider: paymentProviderCodeSchema });

function strRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'string') out[k] = x;
  return out;
}

function toInput(req: FastifyRequest): WebhookInput {
  return { method: req.method === 'GET' ? 'GET' : 'POST', query: strRecord(req.query), body: req.body ?? null, headers: req.headers };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Callback cổng thanh toán (không xác thực người dùng – xác minh chữ ký). VNPay gọi IPN bằng GET, MoMo/ZaloPay POST JSON.
 * Phản hồi theo định dạng từng cổng; sai chữ ký → 400 + audit `payment.webhook_rejected`. Return URL chỉ hiển thị.
 */
@ApiTags('Webhooks')
@Controller()
export class WebhooksController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly payments: PaymentsService,
  ) {}

  private async webhook(provider: string, req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ack = await this.payments.handleWebhook(provider, toInput(req), { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
    if (ack.status === 204 || ack.body === null) {
      await reply.status(ack.status).send();
      return;
    }
    await reply.status(ack.status).header('content-type', 'application/json; charset=utf-8').send(JSON.stringify(ack.body));
  }

  @Public()
  @Post('webhooks/payments/:provider')
  @RateLimit('webhook_ip')
  @ApiResponse({ status: 200, description: 'Theo định dạng cổng (VNPay RspCode, ZaloPay return_code)' })
  @ApiResponse({ status: 204, description: 'MoMo IPN đã nhận' })
  @ApiResponse({ status: 400, description: 'Sai chữ ký / payload' })
  async postWebhook(@ZodParams(providerParam) p: z.infer<typeof providerParam>, @Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    await this.webhook(p.provider, req, reply);
  }

  /** VNPay IPN (GET + query `vnp_*`) */
  @Public()
  @Get('webhooks/payments/:provider')
  @RateLimit('webhook_ip')
  @ApiResponse({ status: 200, description: 'VNPay `{ RspCode, Message }`' })
  @ApiResponse({ status: 400, description: 'Sai chữ ký' })
  async getWebhook(@ZodParams(providerParam) p: z.infer<typeof providerParam>, @Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    await this.webhook(p.provider, req, reply);
  }

  /** Cổng chuyển trình duyệt về: 302 tới web (`return_url` của /pay) kèm order_id/status đọc từ DB; `Accept: application/json` → JSON */
  @Public()
  @Get('payments/return/:provider')
  @ApiResponse({ status: 200, description: 'JSON trạng thái hiển thị (Accept: application/json)' })
  @ApiResponse({ status: 302, description: 'Chuyển về trang kết quả của web' })
  async paymentReturn(@ZodParams(providerParam) p: z.infer<typeof providerParam>, @Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const r = await this.payments.handleReturn(p.provider, strRecord(req.query));
    const wantsJson = String(req.headers.accept ?? '').includes('application/json') || (req.query as Record<string, unknown>)?.format === 'json';
    if (wantsJson) {
      await reply.status(200).send(r);
      return;
    }
    await reply.status(302).header('location', r.redirect_url).header('cache-control', 'no-store').send();
  }

  // ------------------------------------------------------------------ cổng giả lập (dev/test/E2E – không có ở production)
  private assertMock(): void {
    if (this.env.APP_ENV === 'production') throw new NotFound('route');
  }

  /** Trang thanh toán giả (công cụ dev, không phải giao diện người dùng cuối – không i18n) */
  @Public()
  @Get('payments/mock/checkout')
  @ApiExcludeEndpoint()
  async mockCheckout(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    this.assertMock();
    const ref = esc(strRecord(req.query).ref ?? '');
    const btn = (outcome: string, label: string, drop = false) =>
      `<form method="post" action="/v1/payments/mock/checkout"><input type="hidden" name="ref" value="${ref}"><input type="hidden" name="outcome" value="${outcome}">${drop ? '<input type="hidden" name="drop_webhook" value="1">' : ''}<button type="submit" data-outcome="${outcome}${drop ? '-drop' : ''}">${label}</button></form>`;
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock payment gateway</title><style>body{font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px}button{width:100%;padding:12px;margin:6px 0;font-size:16px;cursor:pointer}</style></head><body><h1>Mock gateway</h1><p>ref: <code>${ref}</code></p>${btn('paid', 'Pay (success)')}${btn('failed', 'Fail')}${btn('cancelled', 'Cancel')}${btn('paid', 'Success but webhook lost (test payment.reconcile)', true)}</body></html>`;
    await reply.status(200).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(html);
  }

  @Public()
  @Post('payments/mock/checkout')
  @ApiExcludeEndpoint()
  async mockCheckoutSubmit(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    this.assertMock();
    const b = strRecord(req.body);
    const outcome = b.outcome === 'failed' || b.outcome === 'cancelled' ? b.outcome : 'paid';
    const r = await this.payments.mockComplete(b.ref ?? '', outcome, { dropWebhook: b.drop_webhook === '1', ip: req.ip ?? null });
    if (String(req.headers.accept ?? '').includes('application/json')) {
      await reply.status(200).send(r);
      return;
    }
    await reply.status(303).header('location', r.redirect_url).send();
  }
}
