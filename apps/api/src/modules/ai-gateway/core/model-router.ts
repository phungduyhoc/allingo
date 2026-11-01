import { Inject, Injectable } from '@nestjs/common';
import type { AiProvider } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { AI_METRICS } from '../../../shared/telemetry/metrics.js';
import { MockProvider } from '../providers/mock.provider.js';
import { VercelProvider } from '../providers/vercel.provider.js';
import { CircuitBreaker, type BreakerState } from './circuit-breaker.js';
import type { ModelProviderAdapter, ResolvedModel, ResolvedTask } from './types.js';

export interface RouteCandidate {
  model: ResolvedModel;
  adapter: ModelProviderAdapter;
  /** true = model primary của route (fallback_used = false) */
  isPrimary: boolean;
}

const MOCK_MODEL: ResolvedModel = { alias: 'mock:mock-1', provider: 'mock', modelId: 'mock-1' };
const STATE_VALUE: Record<BreakerState, number> = { closed: 0, half_open: 1, open: 2 };

/**
 * Ánh xạ alias trong spec (google:gemini-flash…) → model id thật (env, SPEC-ISSUES S6) và adapter.
 * Thứ tự thử: primary → fallbacks của `ai.model_routes`; bỏ qua provider thiếu khoá (isConfigured=false) hoặc breaker OPEN.
 * Circuit breaker theo provider (S5): mở sau AI_BREAKER_FAILURES lỗi / AI_BREAKER_WINDOW_MS, half-open sau AI_BREAKER_OPEN_MS
 * (cho 1 probe), log cảnh báo mỗi lần đổi trạng thái; gauge `ai_provider_circuit_state`.
 * Không còn model nào: dev/test → MockProvider (cảnh báo); staging/production → [] (AiGateway trả not_configured, KHÔNG trả nội dung giả).
 */
@Injectable()
export class ModelRouter {
  private readonly logger = getLogger({ component: 'ai.router' });
  private readonly adapters = new Map<AiProvider, ModelProviderAdapter>();
  private readonly breakers = new Map<AiProvider, CircuitBreaker>();
  mock: MockProvider;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.mock = new MockProvider();
    this.adapters.set('mock', this.mock);
    this.adapters.set('google', new VercelProvider('google', env.GOOGLE_GENERATIVE_AI_API_KEY));
    this.adapters.set('anthropic', new VercelProvider('anthropic', env.ANTHROPIC_API_KEY));
    this.adapters.set('openai', new VercelProvider('openai', env.OPENAI_API_KEY));
  }

  /** Cho phép thay adapter trong test (vd. VercelProvider với MockLanguageModelV4, provider lỗi giả) */
  setAdapter(provider: AiProvider, adapter: ModelProviderAdapter): void {
    this.adapters.set(provider, adapter);
    if (provider === 'mock' && adapter instanceof MockProvider) this.mock = adapter;
  }

  adapterOf(provider: AiProvider): ModelProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  get mode(): 'mock' | 'live' {
    return this.env.AI_PROVIDER;
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

  breaker(provider: AiProvider): CircuitBreaker {
    let b = this.breakers.get(provider);
    if (!b) {
      b = new CircuitBreaker({ failureThreshold: this.env.AI_BREAKER_FAILURES, windowMs: this.env.AI_BREAKER_WINDOW_MS, openMs: this.env.AI_BREAKER_OPEN_MS }, this.clock, {
        onOpen: ({ failures, until }) => {
          AI_METRICS.breakerState.set({ provider }, STATE_VALUE.open);
          this.logger.warn({ provider, failures, open_until: new Date(until).toISOString() }, 'circuit breaker OPEN – provider skipped, using fallback models');
        },
        onHalfOpen: () => {
          AI_METRICS.breakerState.set({ provider }, STATE_VALUE.half_open);
          this.logger.warn({ provider }, 'circuit breaker HALF_OPEN – allowing one probe request');
        },
        onClose: () => {
          AI_METRICS.breakerState.set({ provider }, STATE_VALUE.closed);
          this.logger.warn({ provider }, 'circuit breaker CLOSED – provider recovered');
        },
      });
      this.breakers.set(provider, b);
      AI_METRICS.breakerState.set({ provider }, STATE_VALUE.closed);
    }
    return b;
  }

  /** Danh sách model theo thứ tự thử (primary → fallbacks), lọc provider chưa cấu hình hoặc breaker OPEN */
  candidates(task: ResolvedTask): RouteCandidate[] {
    if (this.env.AI_PROVIDER === 'mock') return [{ model: MOCK_MODEL, adapter: this.mock, isPrimary: true }];
    const aliases = [task.route.primaryModel, ...task.route.fallbackModels];
    const out: RouteCandidate[] = [];
    const skipped: Array<{ alias: string; reason: string }> = [];
    for (const alias of aliases) {
      const model = this.resolveAlias(alias);
      const adapter = this.adapters.get(model.provider);
      if (!adapter?.isConfigured()) {
        skipped.push({ alias, reason: 'not_configured' });
        continue;
      }
      if (model.provider !== 'mock' && !this.breaker(model.provider).canRequest()) {
        skipped.push({ alias, reason: 'circuit_open' });
        continue;
      }
      out.push({ model, adapter, isPrimary: alias === task.route.primaryModel });
    }
    if (skipped.length) this.logger.debug({ task: task.taskCode, skipped }, 'route candidates skipped');
    if (out.length === 0) {
      if (this.env.APP_ENV === 'production' || this.env.APP_ENV === 'staging') {
        this.logger.error({ task: task.taskCode, skipped }, 'no available model for task (all providers unconfigured or circuit open)');
        return [];
      }
      this.logger.warn({ task: task.taskCode, aliases }, 'no configured provider; falling back to mock (dev/test only)');
      out.push({ model: MOCK_MODEL, adapter: this.mock, isPrimary: false });
    }
    return out;
  }

  /** Giữ chỗ probe khi breaker HALF_OPEN */
  begin(provider: AiProvider): void {
    if (provider !== 'mock') this.breaker(provider).begin();
  }

  recordFailure(provider: AiProvider): void {
    if (provider === 'mock') return;
    this.breaker(provider).onFailure();
  }

  recordSuccess(provider: AiProvider): void {
    if (provider === 'mock') return;
    this.breaker(provider).onSuccess();
  }

  /** Đặt lại mọi breaker về CLOSED (vận hành/test) */
  resetBreakers(): void {
    this.breakers.clear();
  }

  isOpen(provider: AiProvider): boolean {
    return this.breakers.get(provider)?.state === 'open';
  }

  breakerSnapshot(): Record<string, ReturnType<CircuitBreaker['snapshot']>> {
    return Object.fromEntries([...this.breakers.entries()].map(([p, b]) => [p, b.snapshot()]));
  }
}
