import { z } from 'zod';

/** Chính sách model trong prompt_versions.model_policy / model_routes */
export const modelPolicySchema = z.object({
  primary: z.string(),
  fallbacks: z.array(z.string()).default([]),
  temperature: z.number().min(0).max(2).default(0.3),
  top_p: z.number().min(0).max(1).default(0.9),
  max_tokens: z.number().int().min(16).max(32_000).default(1024),
});
export type ModelPolicy = z.infer<typeof modelPolicySchema>;

/** Alias model trong spec: provider:alias (vd google:gemini-flash) */
export const MODEL_ALIASES = [
  'google:gemini-flash',
  'google:gemini-pro',
  'anthropic:claude-haiku',
  'anthropic:claude-sonnet',
  'openai:gpt-mini',
  'openai:gpt',
] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const AI_PROVIDERS = ['google', 'anthropic', 'openai', 'mock'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const aiTaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'timeout', 'refused']);
export type AiTaskStatus = z.infer<typeof aiTaskStatusSchema>;

/** Sự kiện SSE của AI Gateway (streamTask) */
export const aiStreamEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('start'), ai_task_id: z.string(), cached: z.boolean() }),
  z.object({ event: z.literal('delta'), text: z.string() }),
  z.object({ event: z.literal('result'), data: z.unknown(), ai_task_id: z.string().nullable(), cached: z.boolean() }),
  z.object({ event: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ event: z.literal('done') }),
]);
export type AiStreamEvent = z.infer<typeof aiStreamEventSchema>;
