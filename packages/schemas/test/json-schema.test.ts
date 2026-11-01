import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { QUESTION_FIXTURES_ALL, QUESTION_TYPE_CODES, questionContentSchemasByType } from '../src/index.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../schemas/question');

describe('JSON Schema packages/schemas/schemas/question/*.json', () => {
  it.each(QUESTION_TYPE_CODES)('%s.json tồn tại, draft 2020-12, $id và title đúng', (code) => {
    const file = path.join(dir, `${code}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(json.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(json.$id).toBe(`https://allingo.vn/schemas/question/${code}.json`);
    expect(typeof json.title).toBe('string');
    expect(json.type).toBe('object');
    const props = json.properties as Record<string, { const?: string }>;
    expect(props.type?.const).toBe(code);
    expect(props.answer_key).toBeDefined();
  });

  it('không có tệp thừa ngoài 12 dạng', () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual([...QUESTION_TYPE_CODES].map((c) => `${c}.json`).sort());
  });

  it.each(QUESTION_TYPE_CODES)('%s: tệp trên đĩa khớp với z.toJSONSchema hiện tại (chạy pnpm gen:question nếu lệch)', (code) => {
    const json = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8')) as Record<string, unknown>;
    const fresh = z.toJSONSchema(questionContentSchemasByType[code], { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !['$schema', '$id', 'title', 'description'].includes(k)));
    expect(strip(json)).toEqual(strip(fresh));
  });

  it('mọi fixture là "required-complete" theo JSON Schema (các trường required đều có mặt)', () => {
    for (const code of QUESTION_TYPE_CODES) {
      const json = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8')) as { required?: string[] };
      for (const f of QUESTION_FIXTURES_ALL[code]) {
        for (const key of json.required ?? []) expect(f.content).toHaveProperty(key);
      }
    }
  });
});
