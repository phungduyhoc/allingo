// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (upgrade_phrasing). Không sửa tay.
import { z } from "zod"

export const upgradePhrasingOutputSchema = z.object({ "verdict": z.enum(["fixed","partly","not_yet"]), "note": z.string().max(240), "remaining_issue": z.union([z.string().max(160), z.null()]), "reveal_suggestion": z.boolean() }).strict()
export type UpgradePhrasingOutput = z.infer<typeof upgradePhrasingOutputSchema>

