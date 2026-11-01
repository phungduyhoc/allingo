import type { Endpoint, PayloadRequest } from 'payload';
import { roleOf } from '../lib/access';
import { fetchReference } from '../lib/internal-api';
import { normalizeReference, STATIC_REFERENCE, type ReferenceData } from '../lib/reference';

/**
 * GET /api/questions/reference – danh mục cho dropdown (programs/sections/topics/subskills/question_types).
 * Lấy từ API nội bộ, cache 60 s; API chưa chạy → fallback tĩnh (TOEIC part1–7 + 12 dạng câu).
 */
let cache: { at: number; data: ReferenceData; source: 'api' | 'static' } | null = null;
const TTL_MS = 60_000;

export async function getReference(): Promise<{ data: ReferenceData; source: 'api' | 'static' }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  try {
    const data = normalizeReference(await fetchReference());
    // API có thể thiếu một nhóm → bù bằng danh mục tĩnh
    cache = {
      at: Date.now(),
      data: {
        programs: data.programs.length ? data.programs : STATIC_REFERENCE.programs,
        sections: data.sections.length ? data.sections : STATIC_REFERENCE.sections,
        topics: data.topics,
        subskills: data.subskills,
        question_types: data.question_types.length ? data.question_types : STATIC_REFERENCE.question_types,
      },
      source: 'api',
    };
  } catch {
    cache = { at: Date.now(), data: STATIC_REFERENCE, source: 'static' };
  }
  return cache;
}

export const referenceEndpoint: Endpoint = {
  path: '/reference',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    if (!roleOf(req)) return Response.json({ error: { code: 'unauthorized', message: 'Cần đăng nhập.' } }, { status: 401 });
    const { data, source } = await getReference();
    return Response.json({ source, ...data });
  },
};
