/**
 * @allingo/planner – lộ trình học thuần (không AI, không I/O) cho Sprint 9 (ADR-0032):
 * - `generatePlan` / `validatePlan`: PlanGenerator theo ngày thi, ngân sách phút/tuần, ngày học, điểm yếu mastery, gói Pro/Free.
 * - `applyAdjustOps`: áp dụng & kiểm tra ràng buộc đề xuất `plan_adjust` (AI chỉ đề xuất ops, server quyết định).
 * - Tiến độ: trạng thái ngày, % tuần, dự báo đúng hướng/chậm, tiến độ tới ngày thi, gợi ý "nếu chỉ có 15 phút".
 */
export * from './types.js';
export * from './dates.js';
export * from './generator.js';
export * from './validate.js';
export * from './adjust.js';
export * from './progress.js';
