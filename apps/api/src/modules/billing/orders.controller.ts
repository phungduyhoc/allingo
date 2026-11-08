import { Controller, Get, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { cursorQuerySchema, orderCreateInputSchema, orderSchema, pageSchema, payInputSchema, payResultSchema, type OrderCreateInput, type PayInput } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { OrdersService } from './orders.service.js';
import { RateLimit } from '../../shared/http/rate-limit.js';

const orderParam = z.object({ orderId: z.uuid() });

/**
 * Đơn hàng & khởi tạo thanh toán (v1.1 – S7). Trạng thái đơn: polling `GET /orders/{id}` hoặc Socket.IO `order.updated`
 * (namespace /ws). Quyền chỉ mở sau webhook – không bao giờ sau return URL.
 */
@ApiTags('Billing')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Tạo đơn (giá chốt server, mã giảm). Idempotency-Key (UUID) bắt buộc: cùng khoá → cùng đơn (200), khác body → 409 */
  @Post('orders')
  @RateLimit('orders')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID, hiệu lực theo người dùng' })
  @ApiZod({ body: orderCreateInputSchema, responses: { 201: orderSchema, 200: orderSchema } })
  async create(@CurrentUser() user: AuthUser, @ZodBody(orderCreateInputSchema) body: OrderCreateInput, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.orders.create(user, body, key);
    if (!r.created) void reply.status(200);
    return r.order;
  }

  @Get('me/orders')
  @ApiZod({ query: cursorQuerySchema, responses: { 200: pageSchema(orderSchema) } })
  mine(@CurrentUser() user: AuthUser, @ZodQuery(cursorQuerySchema) q: z.infer<typeof cursorQuerySchema>) {
    return this.orders.listMine(user.id, q.cursor, q.limit);
  }

  @Get('orders/:orderId')
  @ApiZod({ responses: { 200: orderSchema } })
  get(@CurrentUser() user: AuthUser, @ZodParams(orderParam) p: z.infer<typeof orderParam>) {
    return this.orders.get(user.id, p.orderId);
  }

  /** Khởi tạo thanh toán → redirect_url | qr_code | deeplink. Cổng không khả dụng 503; đơn không trả được 409; cổng lỗi 502 */
  @Post('orders/:orderId/pay')
  @RateLimit('pay')
  @HttpCode(200)
  @ApiZod({ body: payInputSchema, responses: { 200: payResultSchema } })
  pay(@CurrentUser() user: AuthUser, @ZodParams(orderParam) p: z.infer<typeof orderParam>, @ZodBody(payInputSchema) body: PayInput, @Req() req: FastifyRequest) {
    return this.orders.pay(user, p.orderId, body, { ip: req.ip ?? null });
  }
}
