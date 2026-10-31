// ⚠️ Sinh tự động bởi scripts/gen-ai.ts từ docs/spec/allingo-prompts.yaml (tutor_chat). Không sửa tay.
import { z } from "zod"

export const tutorChatOutputSchema = z.object({ "reply_markdown": z.string().max(1400), "actions": z.array(z.object({ "type": z.enum(["open_page","start_task","show_question"]), "target": z.string(), "label": z.string().max(60) })).max(2), "suggested_followups": z.array(z.string().max(80)).max(3), "grounded_on": z.array(z.string()).describe("Khoá dữ liệu trong <data> đã dùng"), "refused": z.boolean().default(false) }).strict()
export type TutorChatOutput = z.infer<typeof tutorChatOutputSchema>

