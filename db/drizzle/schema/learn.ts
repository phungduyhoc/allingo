// ⚠️ Tệp sinh tự động bởi db/scripts/organize-schema.ts từ drizzle-kit pull. Không sửa tay —
// thay đổi schema = migration SQL mới trong db/drizzle/migrations + cập nhật docs/spec/allingo-schema.sql, rồi chạy pnpm schema:refresh.

import {
  unique,
  uuid,
  text,
  boolean,
  smallint,
  timestamp,
  index,
  foreignKey,
  jsonb,
  integer,
  bigint,
  numeric,
  date,
  real,
  pgPolicy,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ScoreBreakdown, AttemptDraftState } from '@allingo/schemas';
import { learn } from './_common.js';
import { aiPromptVersions } from './ai.js';
import {
  catalogLessons,
  catalogMediaAssets,
  catalogPrograms,
  catalogQuestions,
  catalogSections,
  catalogSkills,
  catalogSubskills,
  catalogTestSets,
  catalogVideos,
} from './catalog.js';
import { iamClasses, iamOrganizations, iamUsers } from './iam.js';

export const learnAttemptMode = learn.enum('attempt_mode', ['exam', 'practice', 'diagnostic', 'drill', 'timed_drill']);

export const learnAttemptStatus = learn.enum('attempt_status', ['in_progress', 'submitted', 'graded', 'abandoned']);

export const learnErrorKind = learn.enum('error_kind', [
  'paraphrase',
  'trap',
  'vocabulary',
  'timeout',
  'grammar',
  'listening_detail',
  'inference',
  'spelling',
  'tone',
  'pronunciation',
  'other',
]);

export const learnPlanTaskStatus = learn.enum('plan_task_status', ['pending', 'done', 'skipped', 'expired']);

export const learnPlanTaskType = learn.enum('plan_task_type', [
  'full_test',
  'part_drill',
  'timed_drill',
  'lesson',
  'grammar',
  'vocab_review',
  'shadowing',
  'dictation',
  'writing',
  'speaking',
  'impromptu',
  'checkin',
  'review_errors',
]);

export const learnSrsCardType = learn.enum('srs_card_type', ['vocab', 'error', 'grammar', 'phoneme', 'sentence']);

export const learnSrsState = learn.enum('srs_state', ['new', 'learning', 'review', 'relearning']);

export const learnSubmissionKind = learn.enum('submission_kind', [
  'writing',
  'speaking',
  'impromptu',
  'shadowing_sentence',
  'pronunciation',
  'grammar_sentence',
  'handwriting',
]);

export const learnSubmissionStatus = learn.enum('submission_status', [
  'queued',
  'processing',
  'graded',
  'failed',
  'cancelled',
]);

export const learnEnrollments = learn.table(
  'enrollments',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    programCode: text('program_code').notNull(),
    targetScore: numeric('target_score', { precision: 6, scale: 2 }),
    targetLevel: text('target_level'),
    examDate: date('exam_date'),
    dailyMinutes: smallint('daily_minutes').default(30).notNull(),
    currentLevel: jsonb('current_level'),
    isActive: boolean('is_active').default(true).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'enrollments_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'enrollments_program_code_fkey',
    }),
    unique('enrollments_user_id_program_code_key').on(table.userId, table.programCode),
  ],
);

export const learnStudyPlans = learn.table(
  'study_plans',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    versionNo: integer('version_no').notNull(),
    strategy: jsonb().notNull(),
    generatedBy: text('generated_by').notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_study_plans_current')
      .using('btree', table.enrollmentId.asc().nullsLast().op('uuid_ops'))
      .where(sql`is_current`),
    foreignKey({
      columns: [table.enrollmentId],
      foreignColumns: [learnEnrollments.id],
      name: 'study_plans_enrollment_id_fkey',
    }).onDelete('cascade'),
    unique('study_plans_enrollment_id_version_no_key').on(table.enrollmentId, table.versionNo),
  ],
);

export const learnPlanWeeks = learn.table(
  'plan_weeks',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    planId: uuid('plan_id').notNull(),
    weekNo: smallint('week_no').notNull(),
    startDate: date('start_date').notNull(),
    focusSkillId: uuid('focus_skill_id'),
    focusSectionId: uuid('focus_section_id'),
    loadMinutes: smallint('load_minutes'),
    checkinDoneAt: timestamp('checkin_done_at', { withTimezone: true, mode: 'date' }),
    adjustment: jsonb(),
  },
  (table) => [
    foreignKey({
      columns: [table.planId],
      foreignColumns: [learnStudyPlans.id],
      name: 'plan_weeks_plan_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.focusSkillId],
      foreignColumns: [catalogSkills.id],
      name: 'plan_weeks_focus_skill_id_fkey',
    }),
    foreignKey({
      columns: [table.focusSectionId],
      foreignColumns: [catalogSections.id],
      name: 'plan_weeks_focus_section_id_fkey',
    }),
    unique('plan_weeks_plan_id_week_no_key').on(table.planId, table.weekNo),
  ],
);

export const learnPlanTasks = learn.table(
  'plan_tasks',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    planWeekId: uuid('plan_week_id').notNull(),
    dueDate: date('due_date').notNull(),
    taskType: learnPlanTaskType('task_type').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    title: jsonb(),
    estMinutes: smallint('est_minutes'),
    status: learnPlanTaskStatus().default('pending').notNull(),
    evidence: jsonb(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    resultRef: jsonb('result_ref'),
  },
  (table) => [
    index('ix_plan_tasks_pending_due')
      .using('btree', table.dueDate.asc().nullsLast().op('date_ops'))
      .where(sql`(status = 'pending'::learn.plan_task_status)`),
    index('ix_plan_tasks_week_due').using(
      'btree',
      table.planWeekId.asc().nullsLast().op('date_ops'),
      table.dueDate.asc().nullsLast().op('date_ops'),
    ),
    foreignKey({
      columns: [table.planWeekId],
      foreignColumns: [learnPlanWeeks.id],
      name: 'plan_tasks_plan_week_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnPlanAdjustments = learn.table(
  'plan_adjustments',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    planId: uuid('plan_id').notNull(),
    planWeekId: uuid('plan_week_id'),
    userId: uuid('user_id').notNull(),
    source: text().notNull(),
    status: text().default('pending').notNull(),
    input: jsonb().default({}).notNull(),
    proposal: jsonb(),
    result: jsonb(),
    aiTaskId: uuid('ai_task_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_plan_adjustments_plan').using(
      'btree',
      table.planId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('ix_plan_adjustments_user').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.planId],
      foreignColumns: [learnStudyPlans.id],
      name: 'plan_adjustments_plan_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.planWeekId],
      foreignColumns: [learnPlanWeeks.id],
      name: 'plan_adjustments_plan_week_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'plan_adjustments_user_id_fkey',
    }).onDelete('cascade'),
    check('plan_adjustments_source_check', sql`source = ANY (ARRAY['checkin'::text, 'instruction'::text])`),
    check(
      'plan_adjustments_status_check',
      sql`status = ANY (ARRAY['pending'::text, 'ready'::text, 'rejected'::text, 'needs_clarification'::text, 'applied'::text, 'expired'::text, 'failed'::text, 'superseded'::text])`,
    ),
  ],
);

export const learnAttempts = learn.table(
  'attempts',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    programCode: text('program_code').notNull(),
    testSetId: uuid('test_set_id'),
    sectionId: uuid('section_id'),
    mode: learnAttemptMode().notNull(),
    status: learnAttemptStatus().default('in_progress').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    timeSpentSec: integer('time_spent_sec'),
    rawScore: numeric('raw_score', { precision: 7, scale: 2 }),
    scaledScore: numeric('scaled_score', { precision: 7, scale: 2 }),
    scoreBreakdown: jsonb('score_breakdown').$type<ScoreBreakdown>(),
    draftState: jsonb('draft_state').$type<AttemptDraftState>(),
    device: jsonb(),
    tabLeaveCount: smallint('tab_leave_count').default(0).notNull(),
    planTaskId: uuid('plan_task_id'),
  },
  (table) => [
    index('ix_attempts_in_progress')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(status = 'in_progress'::learn.attempt_status)`),
    index('ix_attempts_test_set').using('btree', table.testSetId.asc().nullsLast().op('uuid_ops')),
    index('ix_attempts_user_started').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.startedAt.desc().nullsFirst().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'attempts_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'attempts_program_code_fkey',
    }),
    foreignKey({
      columns: [table.testSetId],
      foreignColumns: [catalogTestSets.id],
      name: 'attempts_test_set_id_fkey',
    }),
    foreignKey({
      columns: [table.sectionId],
      foreignColumns: [catalogSections.id],
      name: 'attempts_section_id_fkey',
    }),
    foreignKey({
      columns: [table.planTaskId],
      foreignColumns: [learnPlanTasks.id],
      name: 'attempts_plan_task_id_fkey',
    }),
  ],
);

export const learnRecordings = learn.table(
  'recordings',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    durationMs: integer('duration_ms'),
    sizeBytes: integer('size_bytes'),
    transcript: jsonb(),
    sttConfidence: numeric('stt_confidence', { precision: 4, scale: 3 }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_recordings_expiry')
      .using('btree', table.expiresAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(expires_at IS NOT NULL)`),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'recordings_user_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnSubmissions = learn.table(
  'submissions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    programCode: text('program_code').notNull(),
    kind: learnSubmissionKind().notNull(),
    promptRefType: text('prompt_ref_type').notNull(),
    promptRefId: uuid('prompt_ref_id'),
    attemptId: uuid('attempt_id'),
    parentSubmissionId: uuid('parent_submission_id'),
    textBody: text('text_body'),
    recordingId: uuid('recording_id'),
    attachmentId: uuid('attachment_id'),
    wordCount: integer('word_count'),
    durationMs: integer('duration_ms'),
    status: learnSubmissionStatus().default('queued').notNull(),
    jobId: text('job_id'),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    gradedAt: timestamp('graded_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_submissions_status')
      .using('btree', table.status.asc().nullsLast().op('enum_ops'))
      .where(sql`(status = ANY (ARRAY['queued'::learn.submission_status, 'processing'::learn.submission_status]))`),
    index('ix_submissions_user_created').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'submissions_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'submissions_program_code_fkey',
    }),
    foreignKey({
      columns: [table.attemptId],
      foreignColumns: [learnAttempts.id],
      name: 'submissions_attempt_id_fkey',
    }),
    foreignKey({
      columns: [table.parentSubmissionId],
      foreignColumns: [table.id],
      name: 'submissions_parent_submission_id_fkey',
    }),
    foreignKey({
      columns: [table.recordingId],
      foreignColumns: [learnRecordings.id],
      name: 'submissions_recording_id_fkey',
    }),
    foreignKey({
      columns: [table.attachmentId],
      foreignColumns: [catalogMediaAssets.id],
      name: 'submissions_attachment_id_fkey',
    }),
  ],
);

export const learnGradingResults = learn.table(
  'grading_results',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    submissionId: uuid('submission_id').notNull(),
    rubricCode: text('rubric_code').notNull(),
    overallScore: numeric('overall_score', { precision: 6, scale: 2 }),
    criterionScores: jsonb('criterion_scores').notNull(),
    feedback: jsonb().notNull(),
    errors: jsonb().default([]).notNull(),
    modelAnswer: text('model_answer'),
    modelAnswerMeta: jsonb('model_answer_meta'),
    confidence: text().default('normal').notNull(),
    promptVersionId: uuid('prompt_version_id'),
    aiTaskId: uuid('ai_task_id'),
    gradedAt: timestamp('graded_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.submissionId],
      foreignColumns: [learnSubmissions.id],
      name: 'grading_results_submission_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.promptVersionId],
      foreignColumns: [aiPromptVersions.id],
      name: 'fk_grading_prompt_version',
    }),
    unique('grading_results_submission_id_key').on(table.submissionId),
  ],
);

export const learnPronunciationScores = learn.table(
  'pronunciation_scores',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    submissionId: uuid('submission_id').notNull(),
    accuracy: numeric({ precision: 5, scale: 2 }),
    fluency: numeric({ precision: 5, scale: 2 }),
    prosody: numeric({ precision: 5, scale: 2 }),
    completeness: numeric({ precision: 5, scale: 2 }),
    overall: numeric({ precision: 5, scale: 2 }),
    words: jsonb().default([]).notNull(),
    tones: jsonb(),
    pitchContour: jsonb('pitch_contour'),
    provider: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.submissionId],
      foreignColumns: [learnSubmissions.id],
      name: 'pronunciation_scores_submission_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnPhrasingFixes = learn.table(
  'phrasing_fixes',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    gradingResultId: uuid('grading_result_id').notNull(),
    errorIndex: smallint('error_index').notNull(),
    userRewrite: text('user_rewrite'),
    verdict: text(),
    aiNote: text('ai_note'),
    carriedOver: boolean('carried_over').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.gradingResultId],
      foreignColumns: [learnGradingResults.id],
      name: 'phrasing_fixes_grading_result_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnErrorLogEntries = learn.table(
  'error_log_entries',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    programCode: text('program_code').notNull(),
    attemptAnswerId: uuid('attempt_answer_id'),
    submissionId: uuid('submission_id'),
    questionId: uuid('question_id'),
    subskillId: uuid('subskill_id'),
    errorKind: learnErrorKind('error_kind').notNull(),
    reasonAuto: jsonb('reason_auto'),
    reasonOverride: learnErrorKind('reason_override'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_error_log_user_recent').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.programCode.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'error_log_entries_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'error_log_entries_program_code_fkey',
    }),
    foreignKey({
      columns: [table.submissionId],
      foreignColumns: [learnSubmissions.id],
      name: 'error_log_entries_submission_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [catalogQuestions.id],
      name: 'error_log_entries_question_id_fkey',
    }),
    foreignKey({
      columns: [table.subskillId],
      foreignColumns: [catalogSubskills.id],
      name: 'error_log_entries_subskill_id_fkey',
    }),
  ],
);

export const learnSrsCards = learn.table(
  'srs_cards',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    programCode: text('program_code').notNull(),
    cardType: learnSrsCardType('card_type').notNull(),
    refId: uuid('ref_id').notNull(),
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    state: learnSrsState().default('new').notNull(),
    stability: real(),
    difficulty: real(),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    lastReviewAt: timestamp('last_review_at', { withTimezone: true, mode: 'date' }),
    reps: integer().default(0).notNull(),
    lapses: integer().default(0).notNull(),
    suspended: boolean().default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_srs_cards_due')
      .using(
        'btree',
        table.userId.asc().nullsLast().op('text_ops'),
        table.programCode.asc().nullsLast().op('uuid_ops'),
        table.dueAt.asc().nullsLast().op('uuid_ops'),
      )
      .where(sql`(NOT suspended)`),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'srs_cards_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'srs_cards_program_code_fkey',
    }),
    unique('srs_cards_user_id_card_type_ref_id_key').on(table.userId, table.cardType, table.refId),
  ],
);

export const learnSrsReviews = learn.table(
  'srs_reviews',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    cardId: uuid('card_id').notNull(),
    rating: smallint().notNull(),
    reviewMode: text('review_mode'),
    elapsedDays: real('elapsed_days'),
    scheduledDays: real('scheduled_days'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_srs_reviews_card').using(
      'btree',
      table.cardId.asc().nullsLast().op('timestamptz_ops'),
      table.reviewedAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.cardId],
      foreignColumns: [learnSrsCards.id],
      name: 'srs_reviews_card_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnNotes = learn.table(
  'notes',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    testSetId: uuid('test_set_id'),
    questionId: uuid('question_id'),
    body: text().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    // v1.1 – Sprint 5 (migration 0003): user | system_summary (summarize_attempt)
    kind: text().default('user').notNull(),
    data: jsonb(),
  },
  (table) => [
    index('ix_notes_user_test').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.testSetId.asc().nullsLast().op('uuid_ops'),
    ),
    index('ix_notes_user_kind').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.kind.asc().nullsLast().op('text_ops'),
      table.updatedAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'notes_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.testSetId],
      foreignColumns: [catalogTestSets.id],
      name: 'notes_test_set_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [catalogQuestions.id],
      name: 'notes_question_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnStreaks = learn.table(
  'streaks',
  {
    userId: uuid('user_id').primaryKey().notNull(),
    currentStreak: integer('current_streak').default(0).notNull(),
    longestStreak: integer('longest_streak').default(0).notNull(),
    lastActiveDate: date('last_active_date'),
    freezeAvailableAt: date('freeze_available_at'),
    freezesUsed: integer('freezes_used').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'streaks_user_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnXpEvents = learn.table(
  'xp_events',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    kind: text().notNull(),
    amount: integer().notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_xp_events_user_date').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'xp_events_user_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnBadges = learn.table('badges', {
  code: text().primaryKey().notNull(),
  name: jsonb().notNull(),
  rule: jsonb().notNull(),
});

export const learnScoreForecasts = learn.table(
  'score_forecasts',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    predictedScore: numeric('predicted_score', { precision: 6, scale: 2 }).notNull(),
    ciLow: numeric('ci_low', { precision: 6, scale: 2 }),
    ciHigh: numeric('ci_high', { precision: 6, scale: 2 }),
    readyDate: date('ready_date'),
    modelVersion: text('model_version').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_score_forecasts_enrollment').using(
      'btree',
      table.enrollmentId.asc().nullsLast().op('timestamptz_ops'),
      table.computedAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.enrollmentId],
      foreignColumns: [learnEnrollments.id],
      name: 'score_forecasts_enrollment_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnChatThreads = learn.table(
  'chat_threads',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    programCode: text('program_code'),
    context: jsonb(),
    title: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_chat_threads_user').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.updatedAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'chat_threads_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'chat_threads_program_code_fkey',
    }),
  ],
);

export const learnChatMessages = learn.table(
  'chat_messages',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    threadId: uuid('thread_id').notNull(),
    role: text().notNull(),
    content: jsonb().notNull(),
    aiTaskId: uuid('ai_task_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_chat_messages_thread').using(
      'btree',
      table.threadId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.threadId],
      foreignColumns: [learnChatThreads.id],
      name: 'chat_messages_thread_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const learnAssignments = learn.table(
  'assignments',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    orgId: uuid('org_id').notNull(),
    classId: uuid('class_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    title: text().notNull(),
    taskType: learnPlanTaskType('task_type').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [iamOrganizations.id],
      name: 'assignments_org_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.classId],
      foreignColumns: [iamClasses.id],
      name: 'assignments_class_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [iamUsers.id],
      name: 'assignments_created_by_fkey',
    }),
    pgPolicy('org_scope_assignments', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true)))`,
    }),
  ],
);

export const learnUserBadges = learn.table(
  'user_badges',
  {
    userId: uuid('user_id').notNull(),
    badgeCode: text('badge_code').notNull(),
    earnedAt: timestamp('earned_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'user_badges_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.badgeCode],
      foreignColumns: [learnBadges.code],
      name: 'user_badges_badge_code_fkey',
    }),
    primaryKey({ columns: [table.userId, table.badgeCode], name: 'user_badges_pkey' }),
  ],
);

export const learnAssignmentSubmissions = learn.table(
  'assignment_submissions',
  {
    assignmentId: uuid('assignment_id').notNull(),
    userId: uuid('user_id').notNull(),
    resultRef: jsonb('result_ref'),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    foreignKey({
      columns: [table.assignmentId],
      foreignColumns: [learnAssignments.id],
      name: 'assignment_submissions_assignment_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'assignment_submissions_user_id_fkey',
    }).onDelete('cascade'),
    primaryKey({ columns: [table.assignmentId, table.userId], name: 'assignment_submissions_pkey' }),
    pgPolicy('org_scope_assignment_submissions', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((user_id)::text = current_setting('app.user_id'::text, true)) OR (EXISTS ( SELECT 1
   FROM learn.assignments a
  WHERE ((a.id = assignment_submissions.assignment_id) AND ((a.org_id)::text = current_setting('app.org_id'::text, true))))))`,
    }),
  ],
);

export const learnShadowingProgress = learn.table(
  'shadowing_progress',
  {
    userId: uuid('user_id').notNull(),
    videoId: uuid('video_id').notNull(),
    sentencesDone: integer('sentences_done').default(0).notNull(),
    bestScores: jsonb('best_scores').default({}).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'shadowing_progress_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [catalogVideos.id],
      name: 'shadowing_progress_video_id_fkey',
    }).onDelete('cascade'),
    primaryKey({ columns: [table.userId, table.videoId], name: 'shadowing_progress_pkey' }),
  ],
);

export const learnSkillMastery = learn.table(
  'skill_mastery',
  {
    userId: uuid('user_id').notNull(),
    programCode: text('program_code').notNull(),
    subskillId: uuid('subskill_id').notNull(),
    mastery: numeric({ precision: 5, scale: 4 }).default('0').notNull(),
    confidence: numeric({ precision: 5, scale: 4 }),
    nObs: integer('n_obs').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'skill_mastery_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'skill_mastery_program_code_fkey',
    }),
    foreignKey({
      columns: [table.subskillId],
      foreignColumns: [catalogSubskills.id],
      name: 'skill_mastery_subskill_id_fkey',
    }),
    primaryKey({ columns: [table.userId, table.subskillId], name: 'skill_mastery_pkey' }),
  ],
);

export const learnLessonProgress = learn.table(
  'lesson_progress',
  {
    userId: uuid('user_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
    status: text().default('in_progress').notNull(),
    currentStep: smallint('current_step').default(1).notNull(),
    score: numeric({ precision: 5, scale: 2 }),
    chatThreadId: uuid('chat_thread_id'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'lesson_progress_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.lessonId],
      foreignColumns: [catalogLessons.id],
      name: 'lesson_progress_lesson_id_fkey',
    }).onDelete('cascade'),
    primaryKey({ columns: [table.userId, table.lessonId], name: 'lesson_progress_pkey' }),
  ],
);

export const learnVUserProgramSummary = learn
  .view('v_user_program_summary', {
    userId: uuid('user_id'),
    programCode: text('program_code'),
    targetScore: numeric('target_score', { precision: 6, scale: 2 }),
    examDate: date('exam_date'),
    lastScaledScore: numeric('last_scaled_score', { precision: 7, scale: 2 }),
    cardsDue: bigint('cards_due', { mode: 'number' }),
    currentStreak: integer('current_streak'),
  })
  .as(
    sql`SELECT e.user_id, e.program_code, e.target_score, e.exam_date, ( SELECT a.scaled_score FROM learn.attempts a WHERE a.user_id = e.user_id AND a.program_code = e.program_code AND a.status = 'graded'::learn.attempt_status AND (a.mode = ANY (ARRAY['exam'::learn.attempt_mode, 'diagnostic'::learn.attempt_mode])) ORDER BY a.submitted_at DESC LIMIT 1) AS last_scaled_score, ( SELECT count(*) AS count FROM learn.srs_cards c WHERE c.user_id = e.user_id AND c.program_code = e.program_code AND c.due_at <= now() AND NOT c.suspended) AS cards_due, s.current_streak FROM learn.enrollments e LEFT JOIN learn.streaks s ON s.user_id = e.user_id WHERE e.is_active`,
  );
