import { generateText, NoObjectGeneratedError, Output, streamText, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { AiProvider } from '@allingo/schemas';
import type { ModelProviderAdapter, ProviderCallOptions, ProviderResult, ProviderStreamChunk } from '../core/types.js';

export type ModelFactory = (modelId: string) => LanguageModel;

/**
 * Adapter nhà cung cấp thật qua Vercel AI SDK (ADR-0007). Mỗi provider một instance; thiếu API key → isConfigured() = false
 * và router bỏ qua model đó (→ fallback theo ai.model_routes).
 * - Structured output: google/openai bật JSON mode (`Output.json()` → responseMimeType / response_format json_object);
 *   anthropic dùng chỉ dẫn JSON trong prompt (common_system rule 6). Zod validate + repair 1 lần ở AiGateway.
 * - Retry: SDK `maxRetries: 0` – AiGateway tự retry lỗi tạm thời có jitter và đếm breaker (S5).
 * - Timeout: AbortSignal.any(signal của caller, timeout của route).
 * - Chi phí: AiGateway tính từ token × bảng giá (model_routes.params.pricing) – adapter không giữ bảng giá.
 * `factory` cho phép test thay model bằng MockLanguageModelV4 (ai/test) mà không gọi mạng.
 */
export class VercelProvider implements ModelProviderAdapter {
  private readonly factory: ModelFactory | null;

  constructor(
    readonly provider: Exclude<AiProvider, 'mock'>,
    apiKey: string | undefined,
    factory?: ModelFactory,
  ) {
    if (factory) {
      this.factory = factory;
    } else if (!apiKey) {
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

  /** JSON mode khi provider hỗ trợ (Anthropic không có response_format JSON tự do) */
  private output(opts: ProviderCallOptions) {
    return opts.jsonMode !== 'none' && this.provider !== 'anthropic' ? Output.json({ name: opts.taskCode }) : undefined;
  }

  /**
   * AI SDK 7 không cho phép message `system` trong `messages` (InvalidPromptError) → tách sang `instructions`
   * (system prompt render từ registry); phần còn lại (few-shot + user, repair) giữ thứ tự.
   */
  private prompt(opts: ProviderCallOptions) {
    const system = opts.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const messages = opts.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    return { ...(system.length ? { instructions: system.join('\n\n') } : {}), messages };
  }

  private signal(opts: ProviderCallOptions): AbortSignal {
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    return opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  }

  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    try {
      const res = await generateText({
        model: this.model(opts.model.modelId),
        ...this.prompt(opts),
        temperature: opts.temperature,
        topP: opts.topP,
        maxOutputTokens: opts.maxTokens,
        abortSignal: this.signal(opts),
        maxRetries: 0,
        output: this.output(opts),
      });
      return { text: res.text, tokensIn: res.usage.inputTokens ?? null, tokensOut: res.usage.outputTokens ?? null, costUsd: null, modelId: opts.model.modelId, provider: this.provider, finishReason: res.finishReason };
    } catch (err) {
      // JSON mode trả văn bản không parse được → trả text để AiGateway chạy bước repair (không coi là lỗi provider)
      if (NoObjectGeneratedError.isInstance(err) && typeof err.text === 'string') {
        return { text: err.text, tokensIn: err.usage?.inputTokens ?? null, tokensOut: err.usage?.outputTokens ?? null, costUsd: null, modelId: opts.model.modelId, provider: this.provider, finishReason: err.finishReason };
      }
      throw err;
    }
  }

  async *stream(opts: ProviderCallOptions): AsyncIterable<ProviderStreamChunk> {
    let streamError: unknown = null;
    const res = streamText({
      model: this.model(opts.model.modelId),
      ...this.prompt(opts),
      temperature: opts.temperature,
      topP: opts.topP,
      maxOutputTokens: opts.maxTokens,
      abortSignal: this.signal(opts),
      maxRetries: 0,
      output: this.output(opts),
      onError: ({ error }) => {
        streamError = error;
      },
    });
    let text = '';
    for await (const delta of res.textStream) {
      text += delta;
      yield { type: 'delta', text: delta };
    }
    if (streamError) throw streamError instanceof Error ? streamError : new Error('stream error');
    const usage = await res.usage;
    yield { type: 'final', result: { text, tokensIn: usage.inputTokens ?? null, tokensOut: usage.outputTokens ?? null, costUsd: null, modelId: opts.model.modelId, provider: this.provider, finishReason: await res.finishReason } };
  }
}
