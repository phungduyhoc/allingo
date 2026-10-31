// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (explain_mcq). Không sửa tay.
import { z } from "zod"

export const explainMcqOutputSchema = z.object({ "tested_point": z.string().max(120), "correct_option": z.string(), "why_correct": z.string().max(500), "why_others_wrong": z.record(z.string(), z.string().max(300)), "chosen_option_trap": z.union([z.string().max(300), z.null()]).optional(), "how_to_spot": z.string().max(300), "related_points": z.array(z.object({ "type": z.enum(["grammar_topic","vocab","strategy","subskill"]), "code": z.string(), "label": z.string() })).max(3), "key_vocab": z.array(z.object({ "term": z.string(), "reading": z.union([z.string(), z.null()]).optional(), "meaning": z.string() })).max(5) }).strict()
export type ExplainMcqOutput = z.infer<typeof explainMcqOutputSchema>

