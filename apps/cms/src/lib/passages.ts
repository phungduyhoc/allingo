import type { SyncPassageRequest } from './internal-api';

/**
 * B5/S24 – passage CMS → catalog: văn bản từng phần (bộ đôi/bộ ba TOEIC Part 7) đồng bộ sang `catalog.passage_parts`; id catalog =
 * id passage CMS (uuid) nên đồng bộ idempotent. Hàm thuần (unit test) – hook Payload gọi `syncPassage` với kết quả.
 */

export interface PassageDocLike {
  id: string | number;
  title?: string | null;
  program?: string | null;
  kind?: string | null;
  difficulty?: string | null;
  body?: string | null;
  status?: string | null;
  parts?: Array<{ title?: string | null; body?: string | null }> | null;
}

const KINDS = new Set(['reading_passage', 'audio_script', 'image_prompt', 'chart_prompt', 'dialogue']);

export function toSyncPassage(doc: PassageDocLike): SyncPassageRequest {
  const parts = (doc.parts ?? []).map((p) => ({ title: p.title?.trim() || null, body: (p.body ?? '').trim() })).filter((p) => p.body.length > 0);
  return {
    passage_id: String(doc.id),
    program: doc.program ?? 'toeic',
    kind: (KINDS.has(doc.kind ?? '') ? doc.kind : 'reading_passage') as SyncPassageRequest['kind'],
    title: doc.title ?? null,
    body: doc.body ?? null,
    difficulty: doc.difficulty ?? null,
    status: doc.status === 'ready' || doc.status === 'retired' ? doc.status : 'draft',
    parts,
  };
}

/** Bản gộp `[Tiêu đề]\n…` (giống API/seed) – hiển thị gợi ý trong CMS khi passage có ≥ 2 văn bản */
export function mergedBody(parts: ReadonlyArray<{ title?: string | null; body?: string | null }>): string {
  return parts
    .filter((p) => (p.body ?? '').trim())
    .map((p, i) => `[${(p.title ?? '').trim() || `Text ${i + 1}`}]\n${(p.body ?? '').trim()}`)
    .join('\n\n');
}
