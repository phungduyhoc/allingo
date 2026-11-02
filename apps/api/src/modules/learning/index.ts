export { LearningModule } from './learning.module.js';
export { ProgressService } from './progress.service.js';
export { AttemptSummaryService, numericFidelity } from './attempt-summary.service.js';
export { ThreadsService } from './tutor/threads.service.js';
export { SrsService } from './srs.service.js';
export { buildTutorContext, estimateTokens, referencedQuestionData, stripPromptTags, type TutorContextInput, type TutorContextResult } from './tutor/context-builder.js';
// S9
export { GamificationService, type AttemptGradedPayload } from './gamification/gamification.service.js';
export { applyStudyDay, effectiveStreak, evaluateBadgeRule, freezeReady, STREAK_FREEZE_COOLDOWN_DAYS, type BadgeFacts, type BadgeRule, type StreakState } from './gamification/rules.js';
export { PlanService, STUDY_PLAN_FLAG, type PlanTree } from './plan/plan.service.js';
export { PlanAdjustService } from './plan/plan-adjust.service.js';
export { DiagnosticService } from './diagnostic/diagnostic.service.js';
export { LearningJobsService, PLAN_EXPIRE_INTERVAL_MS } from './learning-jobs.service.js';
export { SECTION_DRILL_MINUTES, TASK_EXPIRE_AFTER_DAYS, PROPOSAL_TTL_HOURS, evidenceText, launchOf, toInventory } from './plan/plan-mapper.js';
