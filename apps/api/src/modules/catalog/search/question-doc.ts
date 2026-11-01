import type { QuestionContent } from '@allingo/schemas';

/**
 * Tài liệu chỉ mục tìm kiếm cho câu hỏi ĐÃ PHÁT HÀNH (bản hiện hành). Tuyệt đối không chứa đáp án, giải thích, evidence
 * (Sprint 2 – tiêu chí nghiệm thu: payload index không chứa answer_key).
 */
export interface QuestionSearchDoc {
  id: string;
  version_id: string;
  program: string;
  section_code: string;
  question_type: string;
  topic: string | null;
  difficulty: string | null;
  stem: string;
  options_text: string;
  passage_excerpt: string;
  tags: string[];
  published_at: number;
}

const FORBIDDEN_KEYS = new Set(['answer_key', 'explanation', 'evidence', 'correct', 'model_answer', 'accepted']);

/** Lấy text hiển thị của lựa chọn/items/pairs – chỉ phần đề, không lấy khoá đáp án */
function optionTexts(content: QuestionContent): string[] {
  const c = content as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['options', 'items', 'left', 'right', 'statements', 'labels', 'bank']) {
    const v = c[key];
    if (!Array.isArray(v)) continue;
    for (const o of v) {
      if (typeof o === 'string') out.push(o);
      else if (o && typeof o === 'object' && typeof (o as { text?: unknown }).text === 'string') out.push((o as { text: string }).text);
    }
  }
  return out;
}

export function buildQuestionDoc(input: {
  question_id: string;
  version_id: string;
  program: string;
  section_code: string;
  question_type: string;
  topic: string | null;
  difficulty: string | null;
  content: QuestionContent;
  passage_body: string | null;
  published_at: Date | string | null;
}): QuestionSearchDoc {
  const c = input.content as unknown as Record<string, unknown>;
  const stem = typeof c.stem === 'string' ? c.stem : '';
  const tags = Array.isArray(c.tags) ? (c.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const doc: QuestionSearchDoc = {
    id: input.question_id,
    version_id: input.version_id,
    program: input.program,
    section_code: input.section_code,
    question_type: input.question_type,
    topic: input.topic,
    difficulty: input.difficulty,
    stem,
    options_text: optionTexts(input.content).join(' | '),
    passage_excerpt: (input.passage_body ?? '').slice(0, 600),
    tags,
    published_at: input.published_at ? new Date(input.published_at).getTime() : 0,
  };
  // Phòng thủ: không để lọt khoá đáp án dù content có cấu trúc lạ
  for (const k of Object.keys(doc)) if (FORBIDDEN_KEYS.has(k)) delete (doc as unknown as Record<string, unknown>)[k];
  return doc;
}
