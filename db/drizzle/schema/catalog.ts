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
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { LocalizedText, QuestionContent } from '@allingo/schemas';
import { catalog } from './_common.js';
import { iamUsers } from './iam.js';

export const catalogContentSource = catalog.enum('content_source', ['human', 'ai', 'licensed', 'user_submitted']);

export const catalogContentStatus = catalog.enum('content_status', [
  'draft',
  'ai_checked',
  'review1',
  'review2',
  'published',
  'retired',
  'rejected',
]);

export const catalogDifficulty = catalog.enum('difficulty', [
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
  'N5',
  'N4',
  'N3',
  'N2',
  'N1',
  'HSK1',
  'HSK2',
  'HSK3',
  'HSK4',
  'HSK5',
  'HSK6',
  'HSK7_9',
  'mixed',
]);

export const catalogLessonKind = catalog.enum('lesson_kind', ['lesson', 'grammar', 'pronunciation', 'strategy']);

export const catalogMediaKind = catalog.enum('media_kind', ['audio', 'image', 'video_ref', 'document']);

export const catalogPassageKind = catalog.enum('passage_kind', [
  'reading_passage',
  'audio_script',
  'image_prompt',
  'chart_prompt',
  'dialogue',
]);

export const catalogReviewDecision = catalog.enum('review_decision', ['approve', 'reject', 'needs_change']);

export const catalogReviewStage = catalog.enum('review_stage', ['ai_check', 'review1', 'review2']);

export const catalogTestSetKind = catalog.enum('test_set_kind', [
  'full',
  'mini',
  'part_drill',
  'diagnostic',
  'topic_pack',
]);

export const catalogVideoCategory = catalog.enum('video_category', [
  'mock_speaking',
  'conversation',
  'movie',
  'story',
  'lecture',
  'anime',
  'news',
  'user_link',
]);

export const catalogVocabKind = catalog.enum('vocab_kind', [
  'word',
  'collocation',
  'phrasal_verb',
  'kanji',
  'hanzi',
  'grammar_point',
]);

export const catalogPrograms = catalog.table('programs', {
  code: text().primaryKey().notNull(),
  name: jsonb().$type<LocalizedText>().notNull(),
  scoreScale: jsonb('score_scale').notNull(),
  languages: text().array().notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: smallint('sort_order').default(0).notNull(),
});

export const catalogSkills = catalog.table(
  'skills',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    code: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    sortOrder: smallint('sort_order').default(0).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'skills_program_code_fkey',
    }),
    unique('skills_program_code_code_key').on(table.programCode, table.code),
  ],
);

export const catalogSections = catalog.table(
  'sections',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    skillId: uuid('skill_id').notNull(),
    code: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    level: text(),
    sortOrder: smallint('sort_order').default(0).notNull(),
    durationSec: integer('duration_sec'),
    questionCount: smallint('question_count'),
    rules: jsonb().default({}).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'sections_program_code_fkey',
    }),
    foreignKey({
      columns: [table.skillId],
      foreignColumns: [catalogSkills.id],
      name: 'sections_skill_id_fkey',
    }),
    unique('sections_program_code_code_level_key').on(table.programCode, table.code, table.level),
  ],
);

export const catalogTopics = catalog.table(
  'topics',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code'),
    code: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'topics_program_code_fkey',
    }),
    unique('topics_program_code_code_key').on(table.programCode, table.code),
  ],
);

export const catalogSubskills = catalog.table(
  'subskills',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    skillId: uuid('skill_id').notNull(),
    code: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    description: jsonb(),
  },
  (table) => [
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'subskills_program_code_fkey',
    }),
    foreignKey({
      columns: [table.skillId],
      foreignColumns: [catalogSkills.id],
      name: 'subskills_skill_id_fkey',
    }),
    unique('subskills_program_code_code_key').on(table.programCode, table.code),
  ],
);

export const catalogMediaAssets = catalog.table(
  'media_assets',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    kind: catalogMediaKind().notNull(),
    storageKey: text('storage_key'),
    externalUrl: text('external_url'),
    mimeType: text('mime_type'),
    durationMs: integer('duration_ms'),
    width: integer(),
    height: integer(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    license: text().default('own').notNull(),
    transcript: jsonb(),
    checksum: text(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [iamUsers.id],
      name: 'media_assets_created_by_fkey',
    }),
  ],
);

export const catalogPassages = catalog.table(
  'passages',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    kind: catalogPassageKind().notNull(),
    title: text(),
    body: text(),
    mediaAssetId: uuid('media_asset_id'),
    wordCount: integer('word_count'),
    difficulty: catalogDifficulty(),
    topicId: uuid('topic_id'),
    source: catalogContentSource().default('human').notNull(),
    status: catalogContentStatus().default('draft').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_passages_program_status').using(
      'btree',
      table.programCode.asc().nullsLast().op('text_ops'),
      table.status.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'passages_program_code_fkey',
    }),
    foreignKey({
      columns: [table.mediaAssetId],
      foreignColumns: [catalogMediaAssets.id],
      name: 'passages_media_asset_id_fkey',
    }),
    foreignKey({
      columns: [table.topicId],
      foreignColumns: [catalogTopics.id],
      name: 'passages_topic_id_fkey',
    }),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [iamUsers.id],
      name: 'passages_created_by_fkey',
    }),
  ],
);

export const catalogQuestions = catalog.table(
  'questions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    sectionId: uuid('section_id').notNull(),
    questionTypeCode: text('question_type_code').notNull(),
    passageId: uuid('passage_id'),
    topicId: uuid('topic_id'),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => catalogQuestionVersions.id),
    status: catalogContentStatus().default('draft').notNull(),
    source: catalogContentSource().default('human').notNull(),
    difficultyTarget: catalogDifficulty('difficulty_target'),
    irtA: numeric('irt_a', { precision: 6, scale: 3 }),
    irtB: numeric('irt_b', { precision: 6, scale: 3 }),
    irtC: numeric('irt_c', { precision: 6, scale: 3 }),
    irtFittedAt: timestamp('irt_fitted_at', { withTimezone: true, mode: 'date' }),
    exposureCount: integer('exposure_count').default(0).notNull(),
    correctCount: integer('correct_count').default(0).notNull(),
    avgTimeMs: integer('avg_time_ms'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_questions_irt')
      .using(
        'btree',
        table.programCode.asc().nullsLast().op('uuid_ops'),
        table.sectionId.asc().nullsLast().op('numeric_ops'),
        table.irtB.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(status = 'published'::catalog.content_status)`),
    index('ix_questions_passage').using('btree', table.passageId.asc().nullsLast().op('uuid_ops')),
    index('ix_questions_program_section_status').using(
      'btree',
      table.programCode.asc().nullsLast().op('enum_ops'),
      table.sectionId.asc().nullsLast().op('uuid_ops'),
      table.status.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'questions_program_code_fkey',
    }),
    foreignKey({
      columns: [table.sectionId],
      foreignColumns: [catalogSections.id],
      name: 'questions_section_id_fkey',
    }),
    foreignKey({
      columns: [table.questionTypeCode],
      foreignColumns: [catalogQuestionTypes.code],
      name: 'questions_question_type_code_fkey',
    }),
    foreignKey({
      columns: [table.passageId],
      foreignColumns: [catalogPassages.id],
      name: 'questions_passage_id_fkey',
    }),
    foreignKey({
      columns: [table.topicId],
      foreignColumns: [catalogTopics.id],
      name: 'questions_topic_id_fkey',
    }),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [iamUsers.id],
      name: 'questions_created_by_fkey',
    }),
  ],
);

export const catalogQuestionTypes = catalog.table('question_types', {
  code: text().primaryKey().notNull(),
  name: jsonb().$type<LocalizedText>().notNull(),
  contentSchema: jsonb('content_schema').notNull(),
  autoGradable: boolean('auto_gradable').default(true).notNull(),
});

export const catalogQuestionVersions = catalog.table(
  'question_versions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    questionId: uuid('question_id').notNull(),
    versionNo: integer('version_no').notNull(),
    content: jsonb().$type<QuestionContent>().notNull(),
    metadata: jsonb().default({}).notNull(),
    changeNote: text('change_note'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [catalogQuestions.id],
      name: 'question_versions_question_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [iamUsers.id],
      name: 'question_versions_created_by_fkey',
    }),
    unique('question_versions_question_id_version_no_key').on(table.questionId, table.versionNo),
  ],
);

export const catalogTestSets = catalog.table(
  'test_sets',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    code: text().notNull(),
    title: jsonb().$type<LocalizedText>().notNull(),
    kind: catalogTestSetKind().notNull(),
    level: text(),
    isFree: boolean('is_free').default(false).notNull(),
    durationSec: integer('duration_sec'),
    yearTag: smallint('year_tag'),
    status: catalogContentStatus().default('draft').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_test_sets_program_kind').using(
      'btree',
      table.programCode.asc().nullsLast().op('enum_ops'),
      table.kind.asc().nullsLast().op('text_ops'),
      table.status.asc().nullsLast().op('enum_ops'),
    ),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'test_sets_program_code_fkey',
    }),
    unique('test_sets_program_code_code_key').on(table.programCode, table.code),
  ],
);

export const catalogGrammarTopics = catalog.table(
  'grammar_topics',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    code: text().notNull(),
    name: jsonb().notNull(),
    level: text(),
    sortOrder: smallint('sort_order').default(0).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'grammar_topics_program_code_fkey',
    }),
    unique('grammar_topics_program_code_code_key').on(table.programCode, table.code),
  ],
);

export const catalogLessons = catalog.table(
  'lessons',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    skillId: uuid('skill_id'),
    sectionId: uuid('section_id'),
    grammarTopicId: uuid('grammar_topic_id'),
    kind: catalogLessonKind().notNull(),
    level: text(),
    title: jsonb().$type<LocalizedText>().notNull(),
    summary: jsonb().$type<LocalizedText>(),
    estMinutes: smallint('est_minutes'),
    isFree: boolean('is_free').default(false).notNull(),
    sortOrder: smallint('sort_order').default(0).notNull(),
    status: catalogContentStatus().default('draft').notNull(),
    source: catalogContentSource().default('human').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_lessons_program_kind').using(
      'btree',
      table.programCode.asc().nullsLast().op('enum_ops'),
      table.kind.asc().nullsLast().op('text_ops'),
      table.status.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'lessons_program_code_fkey',
    }),
    foreignKey({
      columns: [table.skillId],
      foreignColumns: [catalogSkills.id],
      name: 'lessons_skill_id_fkey',
    }),
    foreignKey({
      columns: [table.sectionId],
      foreignColumns: [catalogSections.id],
      name: 'lessons_section_id_fkey',
    }),
    foreignKey({
      columns: [table.grammarTopicId],
      foreignColumns: [catalogGrammarTopics.id],
      name: 'lessons_grammar_topic_id_fkey',
    }),
  ],
);

export const catalogLessonSteps = catalog.table(
  'lesson_steps',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    lessonId: uuid('lesson_id').notNull(),
    sortOrder: smallint('sort_order').notNull(),
    stepType: text('step_type').notNull(),
    content: jsonb().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.lessonId],
      foreignColumns: [catalogLessons.id],
      name: 'lesson_steps_lesson_id_fkey',
    }).onDelete('cascade'),
    unique('lesson_steps_lesson_id_sort_order_key').on(table.lessonId, table.sortOrder),
  ],
);

export const catalogExercises = catalog.table(
  'exercises',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    lessonId: uuid('lesson_id'),
    grammarTopicId: uuid('grammar_topic_id'),
    exerciseType: text('exercise_type').notNull(),
    content: jsonb().notNull(),
    answer: jsonb().notNull(),
    difficulty: catalogDifficulty(),
    status: catalogContentStatus().default('draft').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_exercises_grammar').using('btree', table.grammarTopicId.asc().nullsLast().op('uuid_ops')),
    index('ix_exercises_lesson').using('btree', table.lessonId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'exercises_program_code_fkey',
    }),
    foreignKey({
      columns: [table.lessonId],
      foreignColumns: [catalogLessons.id],
      name: 'exercises_lesson_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.grammarTopicId],
      foreignColumns: [catalogGrammarTopics.id],
      name: 'exercises_grammar_topic_id_fkey',
    }),
  ],
);

export const catalogVideos = catalog.table(
  'videos',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    youtubeId: text('youtube_id').notNull(),
    title: text().notNull(),
    channel: text(),
    durationSec: integer('duration_sec'),
    language: text().notNull(),
    category: catalogVideoCategory().notNull(),
    level: text(),
    status: catalogContentStatus().default('draft').notNull(),
    submittedBy: uuid('submitted_by'),
    segmentJob: jsonb('segment_job'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_videos_program_category').using(
      'btree',
      table.programCode.asc().nullsLast().op('enum_ops'),
      table.category.asc().nullsLast().op('text_ops'),
      table.status.asc().nullsLast().op('enum_ops'),
    ),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'videos_program_code_fkey',
    }),
    foreignKey({
      columns: [table.submittedBy],
      foreignColumns: [iamUsers.id],
      name: 'videos_submitted_by_fkey',
    }),
    unique('videos_program_code_youtube_id_key').on(table.programCode, table.youtubeId),
  ],
);

export const catalogVideoSentences = catalog.table(
  'video_sentences',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    videoId: uuid('video_id').notNull(),
    sortOrder: integer('sort_order').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text().notNull(),
    ipa: text(),
    reading: text(),
    translations: jsonb().default({}).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [catalogVideos.id],
      name: 'video_sentences_video_id_fkey',
    }).onDelete('cascade'),
    unique('video_sentences_video_id_sort_order_key').on(table.videoId, table.sortOrder),
  ],
);

export const catalogVocabItems = catalog.table(
  'vocab_items',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    kind: catalogVocabKind().default('word').notNull(),
    headword: text().notNull(),
    reading: text(),
    sinoVietnamese: text('sino_vietnamese'),
    pos: text(),
    ipaUk: text('ipa_uk'),
    ipaUs: text('ipa_us'),
    audioUkId: uuid('audio_uk_id'),
    audioUsId: uuid('audio_us_id'),
    meanings: jsonb().notNull(),
    examples: jsonb().default([]).notNull(),
    collocations: jsonb().default([]).notNull(),
    radicals: text().array(),
    strokeCount: smallint('stroke_count'),
    level: text(),
    frequencyRank: integer('frequency_rank'),
    source: catalogContentSource().default('human').notNull(),
    status: catalogContentStatus().default('published').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_vocab_items_headword_trgm').using('gin', table.headword.asc().nullsLast().op('gin_trgm_ops')),
    index('ix_vocab_items_program_headword').using(
      'btree',
      table.programCode.asc().nullsLast().op('text_ops'),
      table.headword.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'vocab_items_program_code_fkey',
    }),
    foreignKey({
      columns: [table.audioUkId],
      foreignColumns: [catalogMediaAssets.id],
      name: 'vocab_items_audio_uk_id_fkey',
    }),
    foreignKey({
      columns: [table.audioUsId],
      foreignColumns: [catalogMediaAssets.id],
      name: 'vocab_items_audio_us_id_fkey',
    }),
  ],
);

export const catalogVocabLists = catalog.table(
  'vocab_lists',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    programCode: text('program_code').notNull(),
    kind: text().notNull(),
    title: jsonb().$type<LocalizedText>().notNull(),
    testSetId: uuid('test_set_id'),
    topicId: uuid('topic_id'),
    ownerUserId: uuid('owner_user_id'),
    isFree: boolean('is_free').default(false).notNull(),
    sortOrder: smallint('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_vocab_lists_owner').using('btree', table.ownerUserId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'vocab_lists_program_code_fkey',
    }),
    foreignKey({
      columns: [table.testSetId],
      foreignColumns: [catalogTestSets.id],
      name: 'vocab_lists_test_set_id_fkey',
    }),
    foreignKey({
      columns: [table.topicId],
      foreignColumns: [catalogTopics.id],
      name: 'vocab_lists_topic_id_fkey',
    }),
    foreignKey({
      columns: [table.ownerUserId],
      foreignColumns: [iamUsers.id],
      name: 'vocab_lists_owner_user_id_fkey',
    }),
  ],
);

export const catalogContentReviews = catalog.table(
  'content_reviews',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    stage: catalogReviewStage().notNull(),
    reviewerId: uuid('reviewer_id'),
    decision: catalogReviewDecision().notNull(),
    notes: text(),
    aiReport: jsonb('ai_report'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_content_reviews_entity').using(
      'btree',
      table.entityType.asc().nullsLast().op('timestamptz_ops'),
      table.entityId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
    foreignKey({
      columns: [table.reviewerId],
      foreignColumns: [iamUsers.id],
      name: 'content_reviews_reviewer_id_fkey',
    }),
  ],
);

export const catalogQuestionSubskills = catalog.table(
  'question_subskills',
  {
    questionId: uuid('question_id').notNull(),
    subskillId: uuid('subskill_id').notNull(),
    weight: numeric({ precision: 4, scale: 2 }).default('1').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [catalogQuestions.id],
      name: 'question_subskills_question_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.subskillId],
      foreignColumns: [catalogSubskills.id],
      name: 'question_subskills_subskill_id_fkey',
    }),
    primaryKey({ columns: [table.questionId, table.subskillId], name: 'question_subskills_pkey' }),
  ],
);

export const catalogVocabListItems = catalog.table(
  'vocab_list_items',
  {
    listId: uuid('list_id').notNull(),
    vocabItemId: uuid('vocab_item_id').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.listId],
      foreignColumns: [catalogVocabLists.id],
      name: 'vocab_list_items_list_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.vocabItemId],
      foreignColumns: [catalogVocabItems.id],
      name: 'vocab_list_items_vocab_item_id_fkey',
    }),
    primaryKey({ columns: [table.listId, table.vocabItemId], name: 'vocab_list_items_pkey' }),
  ],
);

export const catalogTestSetSections = catalog.table(
  'test_set_sections',
  {
    testSetId: uuid('test_set_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    sortOrder: smallint('sort_order').notNull(),
    durationSec: integer('duration_sec'),
  },
  (table) => [
    foreignKey({
      columns: [table.testSetId],
      foreignColumns: [catalogTestSets.id],
      name: 'test_set_sections_test_set_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sectionId],
      foreignColumns: [catalogSections.id],
      name: 'test_set_sections_section_id_fkey',
    }),
    primaryKey({ columns: [table.testSetId, table.sectionId], name: 'test_set_sections_pkey' }),
  ],
);

export const catalogTestSetItems = catalog.table(
  'test_set_items',
  {
    testSetId: uuid('test_set_id').notNull(),
    questionId: uuid('question_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    sortOrder: smallint('sort_order').notNull(),
    groupKey: text('group_key'),
    points: numeric({ precision: 5, scale: 2 }).default('1').notNull(),
  },
  (table) => [
    index('ix_test_set_items_order').using(
      'btree',
      table.testSetId.asc().nullsLast().op('uuid_ops'),
      table.sectionId.asc().nullsLast().op('uuid_ops'),
      table.sortOrder.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.testSetId],
      foreignColumns: [catalogTestSets.id],
      name: 'test_set_items_test_set_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [catalogQuestions.id],
      name: 'test_set_items_question_id_fkey',
    }),
    foreignKey({
      columns: [table.sectionId],
      foreignColumns: [catalogSections.id],
      name: 'test_set_items_section_id_fkey',
    }),
    primaryKey({ columns: [table.testSetId, table.questionId], name: 'test_set_items_pkey' }),
  ],
);
