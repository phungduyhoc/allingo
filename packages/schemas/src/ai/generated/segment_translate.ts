// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (segment_translate). Không sửa tay.
import { z } from "zod"

export const segmentTranslateOutputSchema = z.object({ "translations": z.array(z.object({ "index": z.number().int(), "text": z.string().max(600), "needs_review": z.boolean() })) }).strict()
export type SegmentTranslateOutput = z.infer<typeof segmentTranslateOutputSchema>

