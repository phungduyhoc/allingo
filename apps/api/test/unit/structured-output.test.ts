import { describe, expect, it } from 'vitest';
import { extractJson, repairPrompt, validateOutput } from '../../src/modules/ai-gateway/core/structured-output.js';

describe('structured output', () => {
  it('trích JSON từ code fence và văn bản thừa', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":1} hope it helps')).toEqual({ a: 1 });
    expect(extractJson('no json here')).toBeUndefined();
  });
  it('validate theo Zod của task', () => {
    const ok = validateOutput('guard_classify', '{"allowed":true,"category":"ok","reason":"x","redacted_text":null}');
    expect(ok.ok).toBe(true);
    const bad = validateOutput('guard_classify', '{"allowed":"yes"}');
    expect(bad.ok).toBe(false);
    expect(bad.issues?.length).toBeGreaterThan(0);
    expect(repairPrompt(bad.issues!, '{}')).toContain('corrected JSON');
  });
});
