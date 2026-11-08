// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (generate_item_set). Không sửa tay.
import { z } from "zod"

export const generateItemSetOutputSchema = z.object({ "passage": z.object({ "kind": z.enum(["reading_passage","audio_script"]), "title": z.string().min(1).max(160), "texts": z.array(z.object({ "title": z.string().min(1).max(120), "body": z.string().min(1).max(6000) }).strict()).min(1).max(3) }).strict(), "questions": z.array(z.object({ "content": z.record(z.string(), z.any()).describe("Theo content_schema của question_type"), "answer": z.any(), "distractor_rationale": z.record(z.string(), z.string().max(160)), "explanation_seed": z.string().max(700), "difficulty_estimate": z.object({ "level": z.string(), "irt_b": z.number().gte(-3).lte(3) }), "subskill_codes": z.array(z.string()).min(1).max(3), "trap_type": z.string().max(60), "keywords": z.array(z.string()).max(8) }).strict()).min(1).max(10) }).strict()
export type GenerateItemSetOutput = z.infer<typeof generateItemSetOutputSchema>

