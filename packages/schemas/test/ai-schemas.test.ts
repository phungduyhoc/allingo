import { describe, expect, it } from 'vitest';
import { AI_OUTPUT_SCHEMAS, AI_PROMPT_META, AI_TASK_CODES, explainMcqOutputSchema, guardClassifyOutputSchema } from '../src/index.js';

describe('AI output schemas', () => {
  it('đủ 15 task_code khớp AI_TASK_CODES', () => {
    expect(Object.keys(AI_OUTPUT_SCHEMAS).sort()).toEqual([...AI_TASK_CODES].sort());
    expect(Object.keys(AI_PROMPT_META).sort()).toEqual([...AI_TASK_CODES].sort());
  });
  it('explain_mcq: strict, từ chối thiếu trường', () => {
    const ok = explainMcqOutputSchema.safeParse({
      tested_point: 'Future tense',
      correct_option: 'B',
      why_correct: 'next Monday',
      why_others_wrong: { A: 'present', C: 'past', D: 'present perfect' },
      how_to_spot: 'time marker',
      related_points: [{ type: 'grammar_topic', code: 'future_simple', label: 'Future simple' }],
      key_vocab: [{ term: 'proposal', meaning: 'đề xuất' }],
    });
    expect(ok.success).toBe(true);
    expect(explainMcqOutputSchema.safeParse({ correct_option: 'B' }).success).toBe(false);
    expect(explainMcqOutputSchema.safeParse({ ...(ok.data as object), extra: 1 }).success).toBe(false);
  });
  it('guard_classify', () => {
    expect(guardClassifyOutputSchema.safeParse({ allowed: true, category: 'ok', reason: 'fine', redacted_text: null }).success).toBe(true);
    expect(guardClassifyOutputSchema.safeParse({ allowed: true, category: 'weird', reason: 'x', redacted_text: null }).success).toBe(false);
  });
});
