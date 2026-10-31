// Sinh Zod cho 14 đầu ra AI từ output_schema (JSON Schema 2020-12) trong docs/spec/allingo-prompts.yaml
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { jsonSchemaToZod } from 'json-schema-to-zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(here, '../../../docs/spec/allingo-prompts.yaml');
const outDir = path.resolve(here, '../src/ai/generated');

interface PromptSpec { code: string; output_schema: Record<string, unknown>; credits_cost?: number; program?: string | null; model_policy?: Record<string, unknown>; cache_key?: string[] }
const spec = parse(fs.readFileSync(specPath, 'utf8')) as { prompts: PromptSpec[] };

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const names: string[] = [];
for (const p of spec.prompts) {
  let code = jsonSchemaToZod(p.output_schema, { module: 'esm', name: `${camel(p.code)}OutputSchema`, type: `${camel(p.code).replace(/^./, (c) => c.toUpperCase())}Output` });
  // Zod 4: z.record cần 2 tham số
  code = code.replace(/z\.record\((?!z\.string\(\)\s*,)/g, 'z.record(z.string(), ');
  const header = `// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (${p.code}). Không sửa tay.\n`;
  fs.writeFileSync(path.join(outDir, `${p.code}.ts`), header + code + '\n');
  names.push(p.code);
}
const index = [
  '// ⚠️ Sinh tự động bởi scripts/gen-ai.ts. Không sửa tay.',
  ...names.map((n) => `export * from './${n}.js';`),
  '',
  "import type { z } from 'zod';",
  ...names.map((n) => `import { ${camel(n)}OutputSchema } from './${n}.js';`),
  '',
  '/** Bản đồ task_code → Zod schema đầu ra */',
  'export const AI_OUTPUT_SCHEMAS = {',
  ...names.map((n) => `  ${n}: ${camel(n)}OutputSchema,`),
  '} as const satisfies Record<string, z.ZodTypeAny>;',
  'export type AiOutputSchemas = typeof AI_OUTPUT_SCHEMAS;',
  'export type AiOutputOf<K extends keyof AiOutputSchemas> = z.infer<AiOutputSchemas[K]>;',
  '',
  '/** Metadata prompt từ spec (credits, policy, cache_key) để seed & kiểm tra chéo */',
  'export const AI_PROMPT_META = ' + JSON.stringify(Object.fromEntries(spec.prompts.map((p) => [p.code, { credits_cost: p.credits_cost ?? 0, program: p.program ?? null, cache_key: p.cache_key ?? null, model_policy: p.model_policy ?? null }])), null, 2) + ' as const;',
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, 'index.ts'), index);
console.log(`[gen-ai] ${names.length} schema → ${outDir}`);
