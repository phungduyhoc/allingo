// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (check_question). Không sửa tay.
import { z } from "zod"

export const checkQuestionOutputSchema = z.object({ "verdict": z.enum(["pass","needs_change","fail"]), "unique_answer": z.boolean(), "key_correct": z.boolean(), "solved_answer": z.any(), "issues": z.array(z.object({ "area": z.enum(["key","language","part_fit","distractors","difficulty","bias","duplicate","other"]), "severity": z.enum(["minor","major"]), "detail": z.string().max(240), "fix": z.union([z.string().max(240), z.null()]).optional() })), "difficulty_estimate": z.object({ "level": z.string(), "irt_b": z.number() }), "part_fit": z.boolean(), "bias_or_sensitivity": z.union([z.string().max(200), z.null()]), "duplicate_risk": z.object({ "level": z.enum(["low","medium","high"]), "reason": z.string().max(200) }), "suggested_patch": z.union([z.record(z.string(), z.any()), z.null()]).optional() }).strict()
export type CheckQuestionOutput = z.infer<typeof checkQuestionOutputSchema>

