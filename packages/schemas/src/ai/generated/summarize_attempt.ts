// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (summarize_attempt). Không sửa tay.
import { z } from "zod"

export const summarizeAttemptOutputSchema = z.object({ "headline": z.string().max(140), "weakest": z.object({ "area": z.string(), "evidence": z.string().max(120) }), "next_tasks": z.array(z.object({ "task_type": z.string(), "ref_hint": z.union([z.string(), z.null()]).optional(), "reason": z.string().max(140) })).max(3), "trend_note": z.union([z.string().max(160), z.null()]).optional() }).strict()
export type SummarizeAttemptOutput = z.infer<typeof summarizeAttemptOutputSchema>

