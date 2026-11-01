/**
 * pnpm eval:build — render prompt (system + user template Handlebars còn giữ {{...}} cho promptfoo) và xuất JSON Schema đầu ra
 * vào eval/prompts/*.txt và eval/schemas/*.json theo docs/spec/allingo-promptfoo.yaml.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPromptSpec } from '@allingo/db/seed';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const spec = loadPromptSpec();
const promptsDir = path.join(root, 'eval/prompts');
const schemasDir = path.join(root, 'eval/schemas');
fs.mkdirSync(promptsDir, { recursive: true });
fs.mkdirSync(schemasDir, { recursive: true });
for (const p of spec.prompts) {
  const system = p.system_prompt.replace('{{> common_system}}', spec.shared.common_system).replace('{{explain_locale_name}}', 'Vietnamese');
  const text = `[SYSTEM]\n${system.trim()}\n\n[USER]\n${p.user_template.trim()}\n`;
  fs.writeFileSync(path.join(promptsDir, `${p.code}.txt`), text);
  fs.writeFileSync(path.join(schemasDir, `${p.code}.json`), JSON.stringify(p.output_schema, null, 2));
}
console.log(`✔ eval:build: ${spec.prompts.length} prompt → eval/prompts, eval/schemas`);
