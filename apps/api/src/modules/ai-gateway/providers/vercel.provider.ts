import { generateText, streamText, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { AiProvider } from '@allingo/schemas';
import type { ModelProviderAdapter, ProviderCallOptions, ProviderResult, ProviderStreamChunk } from '../core/types.js';

/**
 * Adapter nhà cung cấp thật qua Vercel AI SDK (ADR-0007). Mỗi provider một instance; thiếu API key → isConfigured() = false
 * và router bỏ qua model đó. Đầu ra JSON được yêu cầu trong prompt; StructuredOutput validate + repair ở lớp trên.
 * Giá USD/1M token để ước tính chi phí (cập nhật trong bảng dưới khi đổi model).
 */
const PRICE_USD_PER_M: Record<string, { in: number; out: number }> = {
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'gpt-5': { in: 1.25, out: 10 },
  'gpt-5-mini': { in: 0.25, out: 2 },
};

export function estimateCostUsd(modelId: string, tokensIn: number | null, tokensOut: number | null): number | null {
  const key = Object.keys(PRICE_USD_PER_M).find((k) => modelId.startsWith(k));
  if (!key || tokensIn === null || tokensOut === null) return null;
  const p = PRICE_USD_PER_M[key]!;
  return Math.round(((tokensIn * p.in + tokensOut * p.out) / 1_000_000) * 1_000_000) / 1_000_000;
}

export class VercelProvider implements ModelProviderAdapter {
  private readonly factory: ((modelId: string) => LanguageModel) | null;

  constructor(
    readonly provider: Exclude<AiProvider, 'mock'>,
    apiKey: string | undefined,
  ) {
    if (!apiKey) {
      this.factory = null;
    } else if (provider === 'google') {
      const g = createGoogleGenerativeAI({ apiKey });
      this.factory = (id) => g(id);
    } else if (provider === 'anthropic') {
      const a = createAnthropic({ apiKey });
      this.factory = (id) => a(id);
    } else {
      const o = createOpenAI({ apiKey });
      this.factory = (id) => o(id);
    }
  }

  isConfigured(): boolean {
    return this.factory !== null;
  }

  private model(id: string): LanguageModel {
    if (!this.factory) throw new Error(`provider ${this.provider} not configured`);
    return this.factory(id);
  }

  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    const res = await generateText({
      model: this.model(opts.model.modelId),
      messages: opts.messages,
      temperature: opts.temperature,
      topP: opts.topP,
      maxOutputTokens: opts.maxTokens,
      abortSignal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs),
      maxRetries: 1,
    });
    const tokensIn = res.usage.inputTokens ?? null;
    const tokensOut = res.usage.outputTokens ?? null;
    return { text: res.text, tokensIn, tokensOut, costUsd: estimateCostUsd(opts.model.modelId, tokensIn, tokensOut), modelId: opts.model.modelId, provider: this.provider, finishReason: res.finishReason };
  }

  async *stream(opts: ProviderCallOptions): AsyncIterable<ProviderStreamChunk> {
    const res = streamText({
      model: this.model(opts.model.modelId),
      messages: opts.messages,
      temperature: opts.temperature,
      topP: opts.topP,
      maxOutputTokens: opts.maxTokens,
      abortSignal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs),
      maxRetries: 1,
    });
    let text = '';
    for await (const delta of res.textStream) {
      text += delta;
      yield { type: 'delta', text: delta };
    }
    const usage = await res.usage;
    const tokensIn = usage.inputTokens ?? null;
    const tokensOut = usage.outputTokens ?? null;
    yield { type: 'final', result: { text, tokensIn, tokensOut, costUsd: estimateCostUsd(opts.model.modelId, tokensIn, tokensOut), modelId: opts.model.modelId, provider: this.provider, finishReason: await res.finishReason } };
  }
}
