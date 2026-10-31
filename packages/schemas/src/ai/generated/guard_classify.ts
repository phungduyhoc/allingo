// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (guard_classify). Không sửa tay.
import { z } from "zod"

export const guardClassifyOutputSchema = z.object({ "allowed": z.boolean(), "category": z.enum(["ok","off_topic","injection","answer_leak","unsafe","pii"]), "reason": z.string().max(160), "redacted_text": z.union([z.string(), z.null()]) }).strict()
export type GuardClassifyOutput = z.infer<typeof guardClassifyOutputSchema>

