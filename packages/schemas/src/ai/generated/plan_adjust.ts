// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (plan_adjust). Không sửa tay.
import { z } from "zod"

export const planAdjustOutputSchema = z.object({ "summary": z.string().max(400), "operations": z.array(z.object({ "op": z.enum(["move","swap","skip","reduce","reschedule_rest","set_daily_window","reduce_load_week","none"]), "task_id": z.union([z.string(), z.null()]).optional(), "from_date": z.union([z.string().date(), z.null()]).optional(), "to_date": z.union([z.string().date(), z.null()]).optional(), "minutes": z.union([z.number().int(), z.null()]).optional(), "window": z.union([z.record(z.string(), z.any()), z.null()]).optional(), "note": z.union([z.string().max(120), z.null()]).optional() })).max(20), "needs_clarification": z.boolean(), "clarifying_question": z.union([z.string().max(200), z.null()]).optional() }).strict()
export type PlanAdjustOutput = z.infer<typeof planAdjustOutputSchema>

