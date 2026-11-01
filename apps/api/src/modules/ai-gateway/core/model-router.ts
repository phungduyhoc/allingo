import { Inject, Injectable } from '@nestjs/common';
import type { AiProvider } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { MockProvider } from '../providers/mock.provider.js';
import { VercelProvider } from '../providers/vercel.provider.js';
import type { ModelProviderAdapter, ResolvedModel, ResolvedTask } from './types.js';

/**
 * Ánh xạ alias trong spec (google:gemini-flash…) → model id thật (env) và adapter.
 * Circuit breaker theo provider: 5 lỗi liên tiếp trong 60 giây → mở 60 giây (bỏ qua provider, dùng fallback).
 */
@Injectable()
export class ModelRouter {
  private readonly logger = getLogger({ component: 'ai.router' });
  private readonly adapters = new Map<AiProvider, ModelProviderAdapter>();
  private readonly breaker = new Map<AiProvider, { failures: number; openedUntil: number; firstFailureAt: number }>();
  readonly mock: MockProvider;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.mock = new MockProvider();
    this.adapters.set('mock', this.mock);
    this.adapters.set('google', new VercelProvider('google', env.GOOGLE_GENERATIVE_AI_API_KEY));
    this.adapters.set('anthropic', new VercelProvider('anthropic', env.ANTHROPIC_API_KEY));
    this.adapters.set('openai', new VercelProvider('openai', env.OPENAI_API_KEY));
  }

  /** Cho phép thay adapter trong test */
  setAdapter(provider: AiProvider, adapter: ModelProviderAdapter): void {
    this.adapters.set(provider, adapter);
  }

  resolveAlias(alias: string): ResolvedModel {
    const [provider, name] = alias.split(':') as [AiProvider, string | undefined];
    const map: Record<string, string> = {
      'google:gemini-flash': this.env.GEMINI_FLASH_MODEL,
      'google:gemini-pro': this.env.GEMINI_PRO_MODEL,
      'anthropic:claude-sonnet': this.env.CLAUDE_SONNET_MODEL,
      'anthropic:claude-haiku': this.env.CLAUDE_HAIKU_MODEL,
      'openai:gpt': this.env.OPENAI_GPT_MODEL,
      'openai:gpt-mini': this.env.OPENAI_GPT_MINI_MODEL,
    };
    return { alias, provider, modelId: map[alias] ?? name ?? alias };
  }

  /** Danh sách model theo thứ tự thử (primary → fallbacks), lọc provider chưa cấu hình hoặc breaker mở; mock khi AI_PROVIDER=mock hoặc không còn model nào */
  candidates(task: ResolvedTask): Array<{ model: ResolvedModel; adapter: ModelProviderAdapter }> {
    if (this.env.AI_PROVIDER === 'mock') return [{ model: { alias: 'mock:mock-1', provider: 'mock', modelId: 'mock-1' }, adapter: this.mock }];
    const aliases = [task.route.primaryModel, ...task.route.fallbackModels];
    const out: Array<{ model: ResolvedModel; adapter: ModelProviderAdapter }> = [];
    for (const alias of aliases) {
      const model = this.resolveAlias(alias);
      const adapter = this.adapters.get(model.provider);
      if (!adapter?.isConfigured()) continue;
      if (this.isOpen(model.provider)) continue;
      out.push({ model, adapter });
    }
    if (out.length === 0) {
      this.logger.warn({ task: task.taskCode, aliases }, 'no configured provider; falling back to mock');
      out.push({ model: { alias: 'mock:mock-1', provider: 'mock', modelId: 'mock-1' }, adapter: this.mock });
    }
    return out;
  }

  isOpen(provider: AiProvider): boolean {
    const b = this.breaker.get(provider);
    return !!b && b.openedUntil > Date.now();
  }

  recordFailure(provider: AiProvider): void {
    if (provider === 'mock') return;
    const now = Date.now();
    const b = this.breaker.get(provider) ?? { failures: 0, openedUntil: 0, firstFailureAt: now };
    if (now - b.firstFailureAt > 60_000) {
      b.failures = 0;
      b.firstFailureAt = now;
    }
    b.failures++;
    if (b.failures >= 5) {
      b.openedUntil = now + 60_000;
      b.failures = 0;
      this.logger.warn({ provider }, 'circuit breaker opened for 60s');
    }
    this.breaker.set(provider, b);
  }

  recordSuccess(provider: AiProvider): void {
    this.breaker.delete(provider);
  }
}
