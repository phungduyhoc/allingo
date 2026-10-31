// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (grade_speaking_toeic). Không sửa tay.
import { z } from "zod"

export const gradeSpeakingToeicOutputSchema = z.object({ "question_type": z.enum(["q1_2_read_aloud","q3_4_describe_picture","q5_7_respond_questions","q8_10_respond_with_info","q11_express_opinion"]), "score": z.number().int().gte(0).lte(5), "max_score": z.union([z.literal(3), z.literal(5)]), "dimension_notes": z.record(z.string(), z.string().max(160)).describe("pronunciation, intonation_stress, grammar, vocabulary, cohesion, relevance_completeness, information_accuracy (chỉ các chiều áp dụng)"), "rationale": z.string().max(700), "errors": z.array(z.object({ "quote": z.string().max(120), "occurrence": z.number().int().gte(1), "type": z.string(), "correction": z.string().max(200) })).max(10), "improved_response": z.string().max(1500), "confidence": z.enum(["low","normal","high"]) }).strict()
export type GradeSpeakingToeicOutput = z.infer<typeof gradeSpeakingToeicOutputSchema>

