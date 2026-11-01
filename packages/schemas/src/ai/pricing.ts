/**
 * Bảng giá model mặc định (USD / 1 triệu token) – nguồn DUY NHẤT trong mã (Sprint 5).
 * Seed ghi bảng này vào `ai.model_routes.params.pricing` cho các alias route dùng; admin sửa giá trong DB không cần deploy.
 * AI Gateway đọc `route.params.pricing[alias]` trước, thiếu mới dùng bảng này. Cập nhật khi nhà cung cấp đổi giá.
 * Giá lấy theo bảng công khai của nhà cung cấp cho mức ngữ cảnh ≤ 200k token (11/2026) – xem docs/ASSUMPTIONS.md A58.
 */
export interface ModelPrice {
  /** Model id tham chiếu khi lập giá (ghi chú, không dùng để định tuyến) */
  model: string;
  /** USD cho 1M token đầu vào */
  in: number;
  /** USD cho 1M token đầu ra */
  out: number;
}

export const DEFAULT_MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  'google:gemini-flash': { model: 'gemini-2.5-flash', in: 0.3, out: 2.5 },
  'google:gemini-pro': { model: 'gemini-2.5-pro', in: 1.25, out: 10 },
  'anthropic:claude-haiku': { model: 'claude-haiku-4-5', in: 1, out: 5 },
  'anthropic:claude-sonnet': { model: 'claude-sonnet-4-5', in: 3, out: 15 },
  'openai:gpt-mini': { model: 'gpt-5-mini', in: 0.25, out: 2 },
  'openai:gpt': { model: 'gpt-5', in: 1.25, out: 10 },
  'mock:mock-1': { model: 'mock-1', in: 0, out: 0 },
};

/** Giá cho alias: ưu tiên bảng trong route params (`pricing`), sau đó bảng mặc định */
export function priceFor(alias: string, routePricing?: Record<string, unknown> | null): ModelPrice | null {
  const fromRoute = routePricing?.[alias] as Partial<ModelPrice> | undefined;
  if (fromRoute && typeof fromRoute.in === 'number' && typeof fromRoute.out === 'number') return { model: fromRoute.model ?? alias, in: fromRoute.in, out: fromRoute.out };
  return DEFAULT_MODEL_PRICING[alias] ?? null;
}

/** Chi phí USD (làm tròn 6 chữ số như cột numeric(10,6)); thiếu giá hoặc token → null */
export function costUsd(price: ModelPrice | null | undefined, tokensIn: number | null | undefined, tokensOut: number | null | undefined): number | null {
  if (!price || tokensIn === null || tokensIn === undefined || tokensOut === null || tokensOut === undefined) return null;
  return Math.round(((tokensIn * price.in + tokensOut * price.out) / 1_000_000) * 1_000_000) / 1_000_000;
}

/** Bảng giá con cho các alias của một route (seed ghi vào model_routes.params.pricing) */
export function pricingForAliases(aliases: readonly string[]): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const a of aliases) {
    const p = DEFAULT_MODEL_PRICING[a];
    if (p) out[a] = p;
  }
  return out;
}
