// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (generate_questions). Không sửa tay.
import { z } from "zod"

export const generateQuestionsOutputSchema = z.object({ "questions": z.array(z.object({ "content": z.record(z.string(), z.any()).describe("Theo content_schema của question_type"), "answer": z.any(), "distractor_rationale": z.record(z.string(), z.string().max(160)), "explanation_seed": z.string().max(700), "difficulty_estimate": z.object({ "level": z.string(), "irt_b": z.number().gte(-3).lte(3) }), "subskill_codes": z.array(z.string()).min(1).max(3), "trap_type": z.string().max(60), "keywords": z.array(z.string()).max(8) }).strict()).min(1).max(50) }).strict()
export type GenerateQuestionsOutput = z.infer<typeof generateQuestionsOutputSchema>

