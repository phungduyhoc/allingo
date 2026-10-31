// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (grade_writing_toeic). Không sửa tay.
import { z } from "zod"

export const gradeWritingToeicOutputSchema = z.object({ "question_type": z.enum(["q1_5_picture","q6_7_email","q8_essay"]), "score": z.number().int().gte(0).lte(5), "max_score": z.union([z.literal(3), z.literal(4), z.literal(5)]), "requirements_met": z.array(z.object({ "requirement": z.string().max(120), "met": z.boolean() })), "rationale": z.string().max(800), "errors": z.array(z.object({ "quote": z.string().max(120), "occurrence": z.number().int().gte(1), "type": z.string(), "explanation": z.string().max(200), "correction": z.string().max(200), "severity": z.enum(["minor","moderate","major"]) })).max(15), "improved_version": z.string().max(3000), "confidence": z.enum(["low","normal","high"]) }).strict()
export type GradeWritingToeicOutput = z.infer<typeof gradeWritingToeicOutputSchema>

