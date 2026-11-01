import { embedMany, type EmbeddingModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { EMBEDDING_DIMENSIONS } from '@allingo/schemas';

/** Nhà cung cấp embedding (S5) – vector luôn L2-chuẩn hoá, đúng EMBEDDING_DIMENSIONS chiều (ai.embeddings vector(1536)) */
export interface EmbeddingProvider {
  /** Ghi vào ai.embeddings.model – chỉ so sánh vector cùng model */
  readonly model: string;
  readonly provider: 'mock' | 'google' | 'openai';
  embed(texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; tokens: number | null }>;
}

export function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n > 0 ? v.map((x) => x / n) : v;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** FNV-1a 32-bit */
function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function normalizeForEmbedding(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/_{2,}|-{3,}|…/g, ' ___ ')
    .replace(/[^\p{L}\p{N}_ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Embedding giả lập TẤT ĐỊNH (dev/test/CI, không khoá AI): băm đặc trưng (trigram ký tự + unigram/bigram từ) vào 1536 chiều
 * với dấu ±, rồi L2-chuẩn hoá. Văn bản giống hệt → cosine 1; khác vài từ → cao; khác chủ đề → thấp. KHÔNG mang ngữ nghĩa
 * (không nhận paraphrase) – chỉ để kiểm tra đường ống dedup; cosine thật phải đo lại với model thật (A63).
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'mock:hash-trigram-1536';
  readonly provider = 'mock' as const;

  static vector(text: string): number[] {
    const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    const t = normalizeForEmbedding(text);
    const add = (feat: string, w: number) => {
      const h = fnv1a(feat);
      const idx = h % EMBEDDING_DIMENSIONS;
      const sign = fnv1a(feat, 0x9e3779b9) & 1 ? 1 : -1;
      v[idx] = v[idx]! + sign * w;
    };
    const padded = ` ${t} `;
    for (let i = 0; i + 3 <= padded.length; i++) add(`c3:${padded.slice(i, i + 3)}`, 1);
    const words = t.split(' ').filter(Boolean);
    for (const w of words) add(`w1:${w}`, 1.5);
    for (let i = 0; i + 1 < words.length; i++) add(`w2:${words[i]} ${words[i + 1]}`, 1);
    if (!t) v[0] = 1;
    return l2normalize(v);
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; tokens: number | null }> {
    return { vectors: texts.map((t) => MockEmbeddingProvider.vector(t)), tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0) };
  }
}

/** Embedding thật qua Vercel AI SDK: OpenAI text-embedding-3-small (1536) hoặc Gemini gemini-embedding-001 (dimensions = 1536) */
export class VercelEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private readonly embedding: EmbeddingModel;

  constructor(
    readonly provider: 'google' | 'openai',
    apiKey: string,
    readonly modelId: string,
    factory?: (modelId: string) => EmbeddingModel,
  ) {
    this.model = `${provider}:${modelId}`;
    if (factory) this.embedding = factory(modelId);
    else if (provider === 'openai') this.embedding = createOpenAI({ apiKey }).embedding(modelId);
    else this.embedding = createGoogleGenerativeAI({ apiKey }).embedding(modelId);
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; tokens: number | null }> {
    const r = await embedMany({ model: this.embedding, values: texts, dimensions: EMBEDDING_DIMENSIONS, maxRetries: 2, abortSignal: signal ?? AbortSignal.timeout(30_000) });
    return { vectors: r.embeddings.map((e) => l2normalize(e.slice(0, EMBEDDING_DIMENSIONS))), tokens: r.usage?.tokens ?? null };
  }
}
