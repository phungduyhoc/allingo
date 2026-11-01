import type { AiProvider, AiTaskCode, ModelPolicy } from '@allingo/schemas';

/** Prompt version đã nạp từ registry DB (ai.prompt_templates/prompt_versions/model_routes) */
export interface ResolvedTask {
  taskCode: AiTaskCode;
  templateId: string;
  promptVersionId: string;
  versionNo: number;
  status: 'draft' | 'canary' | 'active' | 'retired';
  systemPrompt: string;
  userTemplate: string;
  fewShots: unknown[];
  outputSchema: Record<string, unknown>;
  modelPolicy: ModelPolicy & { cache_key?: string[] | null; partials?: Record<string, string> };
  route: { primaryModel: string; fallbackModels: string[]; params: Record<string, unknown>; timeoutMs: number; creditsCost: number };
}

export interface ResolvedModel {
  /** alias trong spec, vd google:gemini-flash */
  alias: string;
  provider: AiProvider;
  modelId: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderCallOptions {
  model: ResolvedModel;
  messages: ChatMessage[];
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
  /** JSON Schema đầu ra để provider bật JSON mode / structured output */
  outputSchema?: Record<string, unknown>;
  taskCode: AiTaskCode;
  signal?: AbortSignal;
}

export interface ProviderResult {
  text: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  modelId: string;
  provider: AiProvider;
  finishReason?: string;
}

export interface ProviderStreamChunk {
  type: 'delta' | 'final';
  text?: string;
  result?: ProviderResult;
}

/** Adapter nhà cung cấp (Vercel AI SDK hoặc mock). Mọi gọi model đi qua đây (CLAUDE.md §5.2). */
export interface ModelProviderAdapter {
  readonly provider: AiProvider;
  isConfigured(): boolean;
  generate(opts: ProviderCallOptions): Promise<ProviderResult>;
  stream(opts: ProviderCallOptions): AsyncIterable<ProviderStreamChunk>;
}

export interface RunTaskInput {
  taskCode: AiTaskCode;
  /** null = tác vụ hệ thống (CMS, job) – không trừ credit */
  userId: string | null;
  /** Biến cho Handlebars; nội dung người học phải nằm trong các biến được template đặt trong <user_input> */
  variables: Record<string, unknown>;
  inputRef?: Record<string, unknown>;
  locale?: string;
  program?: string | null;
  /** Mặc định true khi có userId; false cho tác vụ nội bộ */
  chargeCredits?: boolean;
  /** Khoá cache tuỳ tác vụ (explain dùng explanation_cache riêng) */
  traceId?: string;
  signal?: AbortSignal;
}

export interface RunTaskResult<T = unknown> {
  data: T;
  aiTaskId: string;
  cached: boolean;
  model: ResolvedModel | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  latencyMs: number;
  creditsCharged: number;
  repaired: boolean;
  fallbackUsed: boolean;
}

export class AiTaskFailedError extends Error {
  constructor(
    readonly reason: 'provider_error' | 'invalid_output' | 'timeout' | 'refused' | 'not_configured',
    message: string,
    readonly aiTaskId?: string,
  ) {
    super(message);
    this.name = 'AiTaskFailedError';
  }
}
