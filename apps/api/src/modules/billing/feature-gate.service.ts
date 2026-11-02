import { Injectable } from '@nestjs/common';
import { FEATURE_GATES, evaluateGate, type FeatureCode, type GateKey } from '@allingo/schemas';
import { Forbidden } from '../../shared/http/errors.js';
import { EntitlementService, type EntitlementContext } from './entitlement.service.js';
import { QuotaService, type QuotaStatus } from './quota.service.js';

export interface GateTicket {
  ctx: EntitlementContext;
  gate: GateKey;
  quota: QuotaStatus | null;
  /** Hoàn lượt quota đã tiêu (nghiệp vụ thất bại sau khi vào cổng) – gọi nhiều lần vẫn chỉ hoàn 1 lần */
  release(): Promise<void>;
}

/**
 * Cổng kiểm soát tính năng dùng chung (Sprint 7, CLAUDE.md §5.7): MỌI endpoint tiêu quota/credit đi qua đây theo bảng
 * `FEATURE_GATES` (packages/config/entitlements.ts) – không hard-code feature_code trong module nghiệp vụ.
 *  - thiếu entitlement → 403 `forbidden` `{ feature, program, gate, upgrade: true }`
 *  - hết quota → 429 `quota_exceeded` `{ quota: QuotaExceededDetails }` (QuotaService)
 *  - credit do AiGateway trừ trong transaction với ai_tasks (402 `insufficient_credits`)
 */
@Injectable()
export class FeatureGateService {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly quotas: QuotaService,
  ) {}

  /** Ngữ cảnh quyền (gói, tính năng) – cho cờ `locked` của UI và hạn mức theo phạm vi */
  context(userId: string, program: string): Promise<EntitlementContext> {
    return this.entitlements.getContext(userId, program);
  }

  /** Chỉ kiểm tra quyền (không tiêu quota) */
  async check(userId: string, program: string, gate: GateKey, opts: { contentIsFree?: boolean } = {}): Promise<EntitlementContext> {
    const ctx = await this.entitlements.getContext(userId, program);
    this.assert(ctx, gate, opts);
    return ctx;
  }

  /** Cờ khoá cho UI (danh sách đề…) – cùng quy tắc với server */
  locked(ctx: EntitlementContext, gate: GateKey, opts: { contentIsFree?: boolean } = {}): boolean {
    return !evaluateGate(FEATURE_GATES[gate], { features: ctx.features, contentIsFree: opts.contentIsFree }).allowed;
  }

  private assert(ctx: EntitlementContext, gate: GateKey, opts: { contentIsFree?: boolean }): void {
    const g = FEATURE_GATES[gate];
    const d = evaluateGate(g, { features: ctx.features, contentIsFree: opts.contentIsFree });
    if (!d.allowed) throw new Forbidden('Feature requires an upgrade', { feature: g.entitlement, program: ctx.program, gate, upgrade: true });
  }

  /** Kiểm tra quyền + tiêu `amount` lượt quota của gate. Trả vé để hoàn lượt khi nghiệp vụ thất bại. */
  async consume(userId: string, program: string, gate: GateKey, opts: { contentIsFree?: boolean; amount?: number } = {}): Promise<GateTicket> {
    const ctx = await this.check(userId, program, gate, opts);
    const g = FEATURE_GATES[gate];
    const amount = opts.amount ?? 1;
    const quotaFeature = g.quota as FeatureCode | null;
    const quota = quotaFeature ? await this.quotas.consume(userId, ctx.planKind, quotaFeature, amount) : null;
    let released = false;
    return {
      ctx,
      gate,
      quota,
      release: async () => {
        if (released || !quotaFeature) return;
        released = true;
        await this.quotas.refund(userId, ctx.planKind, quotaFeature, amount);
      },
    };
  }

  /** Giới hạn quota theo phạm vi (vd lượt/thread gia sư) cho gói hiện tại; null = không giới hạn */
  async scopedLimit(planKind: EntitlementContext['planKind'] | undefined, gate: GateKey): Promise<number | null> {
    const g = FEATURE_GATES[gate] as { scopedQuota?: FeatureCode };
    if (!g.scopedQuota) return null;
    const own = planKind ? await this.quotas.limitFor(planKind, g.scopedQuota) : null;
    if (own) return own.limit;
    // S9 (sửa lỗi turns.limit = null): gói không có dòng quota theo phạm vi (b2b_seat, credit_pack, ngữ cảnh cache cũ thiếu
    // planKind…) KHÔNG được coi là không giới hạn – áp hạn mức của gói tương đương: gói trả phí → monthly, còn lại → free.
    const fallback: EntitlementContext['planKind'] = planKind && planKind !== 'free' && planKind !== 'credit_pack' ? 'monthly' : 'free';
    return (await this.quotas.limitFor(fallback, g.scopedQuota))?.limit ?? null;
  }
}
