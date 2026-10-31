// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (diagnose_rl). Không sửa tay.
import { z } from "zod"

export const diagnoseRlOutputSchema = z.object({ "top_error_type": z.string(), "evidence": z.array(z.string().max(240)).min(1).max(2), "why": z.string().max(500), "steps": z.array(z.string().max(160)).min(3).max(3), "check_question": z.object({ "stem": z.string(), "options": z.array(z.string()).min(3).max(4), "answer": z.string(), "explanation": z.string().max(240) }), "encouragement": z.string().max(160) }).strict()
export type DiagnoseRlOutput = z.infer<typeof diagnoseRlOutputSchema>

