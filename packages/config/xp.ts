/**
 * Bảng điểm XP theo hành động (Sprint 9, FR-GM-*) – nguồn duy nhất dùng chung API và web (bundle vào `@allingo/schemas`
 * giống `entitlements.ts`, không import gói khác).
 *
 * - API (learning/GamificationService) ghi `learn.xp_events` với `kind` = khoá của bảng này; mỗi sự kiện idempotent theo
 *   (kind, ref_type, ref_id) nên phát lại outbox không cộng trùng.
 * - test-engine tính `xp_earned` khi nộp bài từ cùng bảng (attempt_* + question_correct × số câu đúng).
 * - Web chỉ dùng để hiển thị ước tính (“+20 XP”), số thật đọc từ `GET /me/stats`.
 *
 * Đổi số = đổi sản phẩm: cập nhật tệp này + ghi ASSUMPTIONS; không đổi khoá đã phát hành (dữ liệu cũ tham chiếu).
 */
export const XP_TABLE = {
  /** Nộp/chấm một bài (practice, drill, mini, diagnostic…) */
  attempt_submitted: 20,
  /** Nộp một đề thi đầy đủ ở Exam Mode (≥ 100 câu) – thay cho attempt_submitted */
  attempt_full_test_submitted: 100,
  /** Mỗi câu đúng trong bài đã chấm */
  question_correct: 2,
  /** Hoàn thành bài học (sự kiện lesson.completed) */
  lesson_completed: 30,
  /** Mỗi thẻ ôn tập (S10) */
  srs_review: 1,
  /** Ngày học đầu tiên trong ngày (giờ người dùng) – một lần/ngày */
  streak_day: 10,
  /** Hoàn thành bài chẩn đoán đầu vào – một lần/attempt */
  diagnostic_completed: 50,
  explain_viewed: 0,
  /** Tự đánh dấu xong một việc trong lộ trình không có kết quả kiểm chứng (vd vocab_review khi chưa có FSRS) */
  plan_task_done: 5,
  /** Điểm danh tuần (POST /me/plan/checkin) – một lần/tuần */
  checkin_submitted: 20,
} as const;

export type XpKind = keyof typeof XP_TABLE;
export const XP_KINDS = Object.keys(XP_TABLE) as XpKind[];

/**
 * XP của một bài đã chấm (test-engine dùng khi nộp, learning dùng khi ghi xp_events).
 * Đề đầy đủ ở Exam Mode (≥ 100 câu) nhận thưởng đề đầy đủ thay cho thưởng bài thường.
 */
export function attemptXp(input: { mode: string; questionCount: number; correct: number }): number {
  const base = input.mode === 'exam' && input.questionCount >= 100 ? XP_TABLE.attempt_full_test_submitted : XP_TABLE.attempt_submitted;
  return base + Math.max(0, input.correct) * XP_TABLE.question_correct;
}

/**
 * Cấp độ hiển thị từ tổng XP (đường cong bậc hai nhẹ): level n cần 50·n·(n+1) XP tích luỹ.
 * Ví dụ 0 → 1, 100 → 2, 300 → 3, 600 → 4. Chỉ để hiển thị, không gate tính năng.
 */
export function levelForXp(total: number): { level: number; current_floor: number; next_at: number } {
  let level = 1;
  while (50 * level * (level + 1) <= Math.max(0, total)) level++;
  return { level, current_floor: 50 * (level - 1) * level, next_at: 50 * level * (level + 1) };
}
