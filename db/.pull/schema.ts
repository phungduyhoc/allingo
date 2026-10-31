import { pgTable, pgSchema, unique, uuid, text, boolean, smallint, timestamp, index, foreignKey, jsonb, inet, integer, bigint, type AnyPgColumn, numeric, date, real, vector, char, check, bigserial, pgPolicy, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const iam = pgSchema("iam");
export const catalog = pgSchema("catalog");
export const learn = pgSchema("learn");
export const ai = pgSchema("ai");
export const billing = pgSchema("billing");
export const ops = pgSchema("ops");
export const promptStatusInAi = ai.enum("prompt_status", ['draft', 'canary', 'active', 'retired'])
export const taskStatusInAi = ai.enum("task_status", ['queued', 'running', 'succeeded', 'failed', 'timeout', 'refused'])
export const creditReasonInBilling = billing.enum("credit_reason", ['purchase', 'subscription_grant', 'referral', 'promo', 'consume', 'refund', 'expire', 'admin_adjust', 'b2b_pool'])
export const orderStatusInBilling = billing.enum("order_status", ['pending', 'paid', 'failed', 'cancelled', 'refunded', 'expired'])
export const paymentProviderInBilling = billing.enum("payment_provider", ['vnpay', 'momo', 'zalopay', 'payos', 'stripe', 'bank_transfer', 'manual'])
export const planKindInBilling = billing.enum("plan_kind", ['free', 'monthly', 'yearly', 'lifetime', 'combo', 'credit_pack', 'b2b_seat'])
export const quotaPeriodInBilling = billing.enum("quota_period", ['day', 'month', 'lifetime'])
export const subscriptionStatusInBilling = billing.enum("subscription_status", ['trialing', 'active', 'past_due', 'cancelled', 'expired', 'lifetime'])
export const contentSourceInCatalog = catalog.enum("content_source", ['human', 'ai', 'licensed', 'user_submitted'])
export const contentStatusInCatalog = catalog.enum("content_status", ['draft', 'ai_checked', 'review1', 'review2', 'published', 'retired', 'rejected'])
export const difficultyInCatalog = catalog.enum("difficulty", ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'N5', 'N4', 'N3', 'N2', 'N1', 'HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7_9', 'mixed'])
export const lessonKindInCatalog = catalog.enum("lesson_kind", ['lesson', 'grammar', 'pronunciation', 'strategy'])
export const mediaKindInCatalog = catalog.enum("media_kind", ['audio', 'image', 'video_ref', 'document'])
export const passageKindInCatalog = catalog.enum("passage_kind", ['reading_passage', 'audio_script', 'image_prompt', 'chart_prompt', 'dialogue'])
export const reviewDecisionInCatalog = catalog.enum("review_decision", ['approve', 'reject', 'needs_change'])
export const reviewStageInCatalog = catalog.enum("review_stage", ['ai_check', 'review1', 'review2'])
export const testSetKindInCatalog = catalog.enum("test_set_kind", ['full', 'mini', 'part_drill', 'diagnostic', 'topic_pack'])
export const videoCategoryInCatalog = catalog.enum("video_category", ['mock_speaking', 'conversation', 'movie', 'story', 'lecture', 'anime', 'news', 'user_link'])
export const vocabKindInCatalog = catalog.enum("vocab_kind", ['word', 'collocation', 'phrasal_verb', 'kanji', 'hanzi', 'grammar_point'])
export const authProviderInIam = iam.enum("auth_provider", ['email', 'phone', 'google', 'apple', 'facebook', 'zalo'])
export const consentTypeInIam = iam.enum("consent_type", ['terms', 'privacy', 'voice_processing', 'marketing', 'minor_guardian'])
export const orgRoleInIam = iam.enum("org_role", ['org_admin', 'teacher', 'learner'])
export const orgTypeInIam = iam.enum("org_type", ['school', 'center', 'company', 'other'])
export const referralStatusInIam = iam.enum("referral_status", ['joined', 'started', 'upgraded'])
export const userStatusInIam = iam.enum("user_status", ['active', 'suspended', 'pending_deletion', 'deleted'])
export const attemptModeInLearn = learn.enum("attempt_mode", ['exam', 'practice', 'diagnostic', 'drill', 'timed_drill'])
export const attemptStatusInLearn = learn.enum("attempt_status", ['in_progress', 'submitted', 'graded', 'abandoned'])
export const errorKindInLearn = learn.enum("error_kind", ['paraphrase', 'trap', 'vocabulary', 'timeout', 'grammar', 'listening_detail', 'inference', 'spelling', 'tone', 'pronunciation', 'other'])
export const planTaskStatusInLearn = learn.enum("plan_task_status", ['pending', 'done', 'skipped', 'expired'])
export const planTaskTypeInLearn = learn.enum("plan_task_type", ['full_test', 'part_drill', 'timed_drill', 'lesson', 'grammar', 'vocab_review', 'shadowing', 'dictation', 'writing', 'speaking', 'impromptu', 'checkin', 'review_errors'])
export const srsCardTypeInLearn = learn.enum("srs_card_type", ['vocab', 'error', 'grammar', 'phoneme', 'sentence'])
export const srsStateInLearn = learn.enum("srs_state", ['new', 'learning', 'review', 'relearning'])
export const submissionKindInLearn = learn.enum("submission_kind", ['writing', 'speaking', 'impromptu', 'shadowing_sentence', 'pronunciation', 'grammar_sentence', 'handwriting'])
export const submissionStatusInLearn = learn.enum("submission_status", ['queued', 'processing', 'graded', 'failed', 'cancelled'])
export const notificationChannelInOps = ops.enum("notification_channel", ['email', 'push', 'zalo', 'sms', 'inapp'])

export const auditLogsIdSeqInOps = ops.sequence("audit_logs_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })
export const outboxIdSeqInOps = ops.sequence("outbox_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })

export const usersInIam = iam.table("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	// TODO: failed to parse database type 'citext'
	email: unknown("email"),
	phone: text(),
	passwordHash: text("password_hash"),
	displayName: text("display_name").notNull(),
	avatarUrl: text("avatar_url"),
	uiLocale: text("ui_locale").default('vi').notNull(),
	explainLocale: text("explain_locale").default('vi').notNull(),
	timezone: text().default('Asia/Ho_Chi_Minh').notNull(),
	status: userStatusInIam().default('active').notNull(),
	isGuest: boolean("is_guest").default(false).notNull(),
	birthYear: smallint("birth_year"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("users_email_key").on(table.email),
	unique("users_phone_key").on(table.phone),
]);

export const authIdentitiesInIam = iam.table("auth_identities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	provider: authProviderInIam().notNull(),
	providerUid: text("provider_uid").notNull(),
	// TODO: failed to parse database type 'citext'
	email: unknown("email"),
	rawProfile: jsonb("raw_profile"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_auth_identities_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "auth_identities_user_id_fkey"
		}).onDelete("cascade"),
	unique("auth_identities_provider_provider_uid_key").on(table.provider, table.providerUid),
]);

export const sessionsInIam = iam.table("sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	refreshTokenHash: text("refresh_token_hash").notNull(),
	device: jsonb(),
	ip: inet(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_sessions_user_active").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "sessions_user_id_fkey"
		}).onDelete("cascade"),
	unique("sessions_refresh_token_hash_key").on(table.refreshTokenHash),
]);

export const userRolesInIam = iam.table("user_roles", {
	userId: uuid("user_id").notNull(),
	roleCode: text("role_code").notNull(),
	programCode: text("program_code"),
	grantedBy: uuid("granted_by"),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "user_roles_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roleCode],
			foreignColumns: [rolesInIam.code],
			name: "user_roles_role_code_fkey"
		}),
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [usersInIam.id],
			name: "user_roles_granted_by_fkey"
		}),
	unique("user_roles_user_id_role_code_program_code_key").on(table.userId, table.roleCode, table.programCode),
]);

export const rolesInIam = iam.table("roles", {
	code: text().primaryKey().notNull(),
	description: text(),
});

export const organizationsInIam = iam.table("organizations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	type: orgTypeInIam().notNull(),
	taxCode: text("tax_code"),
	domain: text(),
	settings: jsonb().default({}).notNull(),
	status: text().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const referralsInIam = iam.table("referrals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	referrerUserId: uuid("referrer_user_id").notNull(),
	refereeUserId: uuid("referee_user_id"),
	code: text().notNull(),
	status: referralStatusInIam().default('joined').notNull(),
	deviceFingerprint: text("device_fingerprint"),
	ip: inet(),
	creditedJoinAt: timestamp("credited_join_at", { withTimezone: true, mode: 'string' }),
	creditedUpgradeAt: timestamp("credited_upgrade_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_referrals_referrer").using("btree", table.referrerUserId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.referrerUserId],
			foreignColumns: [usersInIam.id],
			name: "referrals_referrer_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.refereeUserId],
			foreignColumns: [usersInIam.id],
			name: "referrals_referee_user_id_fkey"
		}).onDelete("cascade"),
	unique("referrals_referee_user_id_key").on(table.refereeUserId),
]);

export const consentsInIam = iam.table("consents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: consentTypeInIam().notNull(),
	version: text().notNull(),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	ip: inet(),
}, (table) => [
	index("ix_consents_user_type").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.type.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "consents_user_id_fkey"
		}).onDelete("cascade"),
]);

export const deletionRequestsInIam = iam.table("deletion_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	exportUrl: text("export_url"),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "deletion_requests_user_id_fkey"
		}),
]);

export const programsInCatalog = catalog.table("programs", {
	code: text().primaryKey().notNull(),
	name: jsonb().notNull(),
	scoreScale: jsonb("score_scale").notNull(),
	languages: text().array().notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: smallint("sort_order").default(0).notNull(),
});

export const skillsInCatalog = catalog.table("skills", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	code: text().notNull(),
	name: jsonb().notNull(),
	sortOrder: smallint("sort_order").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "skills_program_code_fkey"
		}),
	unique("skills_program_code_code_key").on(table.programCode, table.code),
]);

export const sectionsInCatalog = catalog.table("sections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	skillId: uuid("skill_id").notNull(),
	code: text().notNull(),
	name: jsonb().notNull(),
	level: text(),
	sortOrder: smallint("sort_order").default(0).notNull(),
	durationSec: integer("duration_sec"),
	questionCount: smallint("question_count"),
	rules: jsonb().default({}).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "sections_program_code_fkey"
		}),
	foreignKey({
			columns: [table.skillId],
			foreignColumns: [skillsInCatalog.id],
			name: "sections_skill_id_fkey"
		}),
	unique("sections_program_code_code_level_key").on(table.programCode, table.code, table.level),
]);

export const topicsInCatalog = catalog.table("topics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code"),
	code: text().notNull(),
	name: jsonb().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "topics_program_code_fkey"
		}),
	unique("topics_program_code_code_key").on(table.programCode, table.code),
]);

export const subskillsInCatalog = catalog.table("subskills", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	skillId: uuid("skill_id").notNull(),
	code: text().notNull(),
	name: jsonb().notNull(),
	description: jsonb(),
}, (table) => [
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "subskills_program_code_fkey"
		}),
	foreignKey({
			columns: [table.skillId],
			foreignColumns: [skillsInCatalog.id],
			name: "subskills_skill_id_fkey"
		}),
	unique("subskills_program_code_code_key").on(table.programCode, table.code),
]);

export const mediaAssetsInCatalog = catalog.table("media_assets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	kind: mediaKindInCatalog().notNull(),
	storageKey: text("storage_key"),
	externalUrl: text("external_url"),
	mimeType: text("mime_type"),
	durationMs: integer("duration_ms"),
	width: integer(),
	height: integer(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	license: text().default('own').notNull(),
	transcript: jsonb(),
	checksum: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [usersInIam.id],
			name: "media_assets_created_by_fkey"
		}),
]);

export const passagesInCatalog = catalog.table("passages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	kind: passageKindInCatalog().notNull(),
	title: text(),
	body: text(),
	mediaAssetId: uuid("media_asset_id"),
	wordCount: integer("word_count"),
	difficulty: difficultyInCatalog(),
	topicId: uuid("topic_id"),
	source: contentSourceInCatalog().default('human').notNull(),
	status: contentStatusInCatalog().default('draft').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_passages_program_status").using("btree", table.programCode.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "passages_program_code_fkey"
		}),
	foreignKey({
			columns: [table.mediaAssetId],
			foreignColumns: [mediaAssetsInCatalog.id],
			name: "passages_media_asset_id_fkey"
		}),
	foreignKey({
			columns: [table.topicId],
			foreignColumns: [topicsInCatalog.id],
			name: "passages_topic_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [usersInIam.id],
			name: "passages_created_by_fkey"
		}),
]);

export const questionsInCatalog = catalog.table("questions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	sectionId: uuid("section_id").notNull(),
	questionTypeCode: text("question_type_code").notNull(),
	passageId: uuid("passage_id"),
	topicId: uuid("topic_id"),
	currentVersionId: uuid("current_version_id"),
	status: contentStatusInCatalog().default('draft').notNull(),
	source: contentSourceInCatalog().default('human').notNull(),
	difficultyTarget: difficultyInCatalog("difficulty_target"),
	irtA: numeric("irt_a", { precision: 6, scale:  3 }),
	irtB: numeric("irt_b", { precision: 6, scale:  3 }),
	irtC: numeric("irt_c", { precision: 6, scale:  3 }),
	irtFittedAt: timestamp("irt_fitted_at", { withTimezone: true, mode: 'string' }),
	exposureCount: integer("exposure_count").default(0).notNull(),
	correctCount: integer("correct_count").default(0).notNull(),
	avgTimeMs: integer("avg_time_ms"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	retiredAt: timestamp("retired_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_questions_irt").using("btree", table.programCode.asc().nullsLast().op("uuid_ops"), table.sectionId.asc().nullsLast().op("numeric_ops"), table.irtB.asc().nullsLast().op("text_ops")).where(sql`(status = 'published'::catalog.content_status)`),
	index("ix_questions_passage").using("btree", table.passageId.asc().nullsLast().op("uuid_ops")),
	index("ix_questions_program_section_status").using("btree", table.programCode.asc().nullsLast().op("enum_ops"), table.sectionId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "questions_program_code_fkey"
		}),
	foreignKey({
			columns: [table.sectionId],
			foreignColumns: [sectionsInCatalog.id],
			name: "questions_section_id_fkey"
		}),
	foreignKey({
			columns: [table.questionTypeCode],
			foreignColumns: [questionTypesInCatalog.code],
			name: "questions_question_type_code_fkey"
		}),
	foreignKey({
			columns: [table.passageId],
			foreignColumns: [passagesInCatalog.id],
			name: "questions_passage_id_fkey"
		}),
	foreignKey({
			columns: [table.topicId],
			foreignColumns: [topicsInCatalog.id],
			name: "questions_topic_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [usersInIam.id],
			name: "questions_created_by_fkey"
		}),
	foreignKey({
			columns: [table.currentVersionId],
			foreignColumns: [questionVersionsInCatalog.id],
			name: "fk_questions_current_version"
		}),
]);

export const questionTypesInCatalog = catalog.table("question_types", {
	code: text().primaryKey().notNull(),
	name: jsonb().notNull(),
	contentSchema: jsonb("content_schema").notNull(),
	autoGradable: boolean("auto_gradable").default(true).notNull(),
});

export const questionVersionsInCatalog = catalog.table("question_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	questionId: uuid("question_id").notNull(),
	versionNo: integer("version_no").notNull(),
	content: jsonb().notNull(),
	metadata: jsonb().default({}).notNull(),
	changeNote: text("change_note"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questionsInCatalog.id],
			name: "question_versions_question_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [usersInIam.id],
			name: "question_versions_created_by_fkey"
		}),
	unique("question_versions_question_id_version_no_key").on(table.questionId, table.versionNo),
]);

export const testSetsInCatalog = catalog.table("test_sets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	code: text().notNull(),
	title: jsonb().notNull(),
	kind: testSetKindInCatalog().notNull(),
	level: text(),
	isFree: boolean("is_free").default(false).notNull(),
	durationSec: integer("duration_sec"),
	yearTag: smallint("year_tag"),
	status: contentStatusInCatalog().default('draft').notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_test_sets_program_kind").using("btree", table.programCode.asc().nullsLast().op("enum_ops"), table.kind.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "test_sets_program_code_fkey"
		}),
	unique("test_sets_program_code_code_key").on(table.programCode, table.code),
]);

export const grammarTopicsInCatalog = catalog.table("grammar_topics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	code: text().notNull(),
	name: jsonb().notNull(),
	level: text(),
	sortOrder: smallint("sort_order").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "grammar_topics_program_code_fkey"
		}),
	unique("grammar_topics_program_code_code_key").on(table.programCode, table.code),
]);

export const lessonsInCatalog = catalog.table("lessons", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	skillId: uuid("skill_id"),
	sectionId: uuid("section_id"),
	grammarTopicId: uuid("grammar_topic_id"),
	kind: lessonKindInCatalog().notNull(),
	level: text(),
	title: jsonb().notNull(),
	summary: jsonb(),
	estMinutes: smallint("est_minutes"),
	isFree: boolean("is_free").default(false).notNull(),
	sortOrder: smallint("sort_order").default(0).notNull(),
	status: contentStatusInCatalog().default('draft').notNull(),
	source: contentSourceInCatalog().default('human').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_lessons_program_kind").using("btree", table.programCode.asc().nullsLast().op("enum_ops"), table.kind.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "lessons_program_code_fkey"
		}),
	foreignKey({
			columns: [table.skillId],
			foreignColumns: [skillsInCatalog.id],
			name: "lessons_skill_id_fkey"
		}),
	foreignKey({
			columns: [table.sectionId],
			foreignColumns: [sectionsInCatalog.id],
			name: "lessons_section_id_fkey"
		}),
	foreignKey({
			columns: [table.grammarTopicId],
			foreignColumns: [grammarTopicsInCatalog.id],
			name: "lessons_grammar_topic_id_fkey"
		}),
]);

export const lessonStepsInCatalog = catalog.table("lesson_steps", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	lessonId: uuid("lesson_id").notNull(),
	sortOrder: smallint("sort_order").notNull(),
	stepType: text("step_type").notNull(),
	content: jsonb().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.lessonId],
			foreignColumns: [lessonsInCatalog.id],
			name: "lesson_steps_lesson_id_fkey"
		}).onDelete("cascade"),
	unique("lesson_steps_lesson_id_sort_order_key").on(table.lessonId, table.sortOrder),
]);

export const exercisesInCatalog = catalog.table("exercises", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	lessonId: uuid("lesson_id"),
	grammarTopicId: uuid("grammar_topic_id"),
	exerciseType: text("exercise_type").notNull(),
	content: jsonb().notNull(),
	answer: jsonb().notNull(),
	difficulty: difficultyInCatalog(),
	status: contentStatusInCatalog().default('draft').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_exercises_grammar").using("btree", table.grammarTopicId.asc().nullsLast().op("uuid_ops")),
	index("ix_exercises_lesson").using("btree", table.lessonId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "exercises_program_code_fkey"
		}),
	foreignKey({
			columns: [table.lessonId],
			foreignColumns: [lessonsInCatalog.id],
			name: "exercises_lesson_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.grammarTopicId],
			foreignColumns: [grammarTopicsInCatalog.id],
			name: "exercises_grammar_topic_id_fkey"
		}),
]);

export const videosInCatalog = catalog.table("videos", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	youtubeId: text("youtube_id").notNull(),
	title: text().notNull(),
	channel: text(),
	durationSec: integer("duration_sec"),
	language: text().notNull(),
	category: videoCategoryInCatalog().notNull(),
	level: text(),
	status: contentStatusInCatalog().default('draft').notNull(),
	submittedBy: uuid("submitted_by"),
	segmentJob: jsonb("segment_job"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_videos_program_category").using("btree", table.programCode.asc().nullsLast().op("enum_ops"), table.category.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "videos_program_code_fkey"
		}),
	foreignKey({
			columns: [table.submittedBy],
			foreignColumns: [usersInIam.id],
			name: "videos_submitted_by_fkey"
		}),
	unique("videos_program_code_youtube_id_key").on(table.programCode, table.youtubeId),
]);

export const videoSentencesInCatalog = catalog.table("video_sentences", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	videoId: uuid("video_id").notNull(),
	sortOrder: integer("sort_order").notNull(),
	startMs: integer("start_ms").notNull(),
	endMs: integer("end_ms").notNull(),
	text: text().notNull(),
	ipa: text(),
	reading: text(),
	translations: jsonb().default({}).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.videoId],
			foreignColumns: [videosInCatalog.id],
			name: "video_sentences_video_id_fkey"
		}).onDelete("cascade"),
	unique("video_sentences_video_id_sort_order_key").on(table.videoId, table.sortOrder),
]);

export const vocabItemsInCatalog = catalog.table("vocab_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	kind: vocabKindInCatalog().default('word').notNull(),
	headword: text().notNull(),
	reading: text(),
	sinoVietnamese: text("sino_vietnamese"),
	pos: text(),
	ipaUk: text("ipa_uk"),
	ipaUs: text("ipa_us"),
	audioUkId: uuid("audio_uk_id"),
	audioUsId: uuid("audio_us_id"),
	meanings: jsonb().notNull(),
	examples: jsonb().default([]).notNull(),
	collocations: jsonb().default([]).notNull(),
	radicals: text().array(),
	strokeCount: smallint("stroke_count"),
	level: text(),
	frequencyRank: integer("frequency_rank"),
	source: contentSourceInCatalog().default('human').notNull(),
	status: contentStatusInCatalog().default('published').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_vocab_items_headword_trgm").using("gin", table.headword.asc().nullsLast().op("gin_trgm_ops")),
	index("ix_vocab_items_program_headword").using("btree", table.programCode.asc().nullsLast().op("text_ops"), table.headword.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "vocab_items_program_code_fkey"
		}),
	foreignKey({
			columns: [table.audioUkId],
			foreignColumns: [mediaAssetsInCatalog.id],
			name: "vocab_items_audio_uk_id_fkey"
		}),
	foreignKey({
			columns: [table.audioUsId],
			foreignColumns: [mediaAssetsInCatalog.id],
			name: "vocab_items_audio_us_id_fkey"
		}),
]);

export const vocabListsInCatalog = catalog.table("vocab_lists", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	programCode: text("program_code").notNull(),
	kind: text().notNull(),
	title: jsonb().notNull(),
	testSetId: uuid("test_set_id"),
	topicId: uuid("topic_id"),
	ownerUserId: uuid("owner_user_id"),
	isFree: boolean("is_free").default(false).notNull(),
	sortOrder: smallint("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_vocab_lists_owner").using("btree", table.ownerUserId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "vocab_lists_program_code_fkey"
		}),
	foreignKey({
			columns: [table.testSetId],
			foreignColumns: [testSetsInCatalog.id],
			name: "vocab_lists_test_set_id_fkey"
		}),
	foreignKey({
			columns: [table.topicId],
			foreignColumns: [topicsInCatalog.id],
			name: "vocab_lists_topic_id_fkey"
		}),
	foreignKey({
			columns: [table.ownerUserId],
			foreignColumns: [usersInIam.id],
			name: "vocab_lists_owner_user_id_fkey"
		}),
]);

export const contentReviewsInCatalog = catalog.table("content_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id").notNull(),
	stage: reviewStageInCatalog().notNull(),
	reviewerId: uuid("reviewer_id"),
	decision: reviewDecisionInCatalog().notNull(),
	notes: text(),
	aiReport: jsonb("ai_report"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_content_reviews_entity").using("btree", table.entityType.asc().nullsLast().op("timestamptz_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.reviewerId],
			foreignColumns: [usersInIam.id],
			name: "content_reviews_reviewer_id_fkey"
		}),
]);

export const enrollmentsInLearn = learn.table("enrollments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	programCode: text("program_code").notNull(),
	targetScore: numeric("target_score", { precision: 6, scale:  2 }),
	targetLevel: text("target_level"),
	examDate: date("exam_date"),
	dailyMinutes: smallint("daily_minutes").default(30).notNull(),
	currentLevel: jsonb("current_level"),
	isActive: boolean("is_active").default(true).notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "enrollments_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "enrollments_program_code_fkey"
		}),
	unique("enrollments_user_id_program_code_key").on(table.userId, table.programCode),
]);

export const studyPlansInLearn = learn.table("study_plans", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	enrollmentId: uuid("enrollment_id").notNull(),
	versionNo: integer("version_no").notNull(),
	strategy: jsonb().notNull(),
	generatedBy: text("generated_by").notNull(),
	isCurrent: boolean("is_current").default(true).notNull(),
	generatedAt: timestamp("generated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_study_plans_current").using("btree", table.enrollmentId.asc().nullsLast().op("uuid_ops")).where(sql`is_current`),
	foreignKey({
			columns: [table.enrollmentId],
			foreignColumns: [enrollmentsInLearn.id],
			name: "study_plans_enrollment_id_fkey"
		}).onDelete("cascade"),
	unique("study_plans_enrollment_id_version_no_key").on(table.enrollmentId, table.versionNo),
]);

export const planWeeksInLearn = learn.table("plan_weeks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	planId: uuid("plan_id").notNull(),
	weekNo: smallint("week_no").notNull(),
	startDate: date("start_date").notNull(),
	focusSkillId: uuid("focus_skill_id"),
	focusSectionId: uuid("focus_section_id"),
	loadMinutes: smallint("load_minutes"),
	checkinDoneAt: timestamp("checkin_done_at", { withTimezone: true, mode: 'string' }),
	adjustment: jsonb(),
}, (table) => [
	foreignKey({
			columns: [table.planId],
			foreignColumns: [studyPlansInLearn.id],
			name: "plan_weeks_plan_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.focusSkillId],
			foreignColumns: [skillsInCatalog.id],
			name: "plan_weeks_focus_skill_id_fkey"
		}),
	foreignKey({
			columns: [table.focusSectionId],
			foreignColumns: [sectionsInCatalog.id],
			name: "plan_weeks_focus_section_id_fkey"
		}),
	unique("plan_weeks_plan_id_week_no_key").on(table.planId, table.weekNo),
]);

export const planTasksInLearn = learn.table("plan_tasks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	planWeekId: uuid("plan_week_id").notNull(),
	dueDate: date("due_date").notNull(),
	taskType: planTaskTypeInLearn("task_type").notNull(),
	refType: text("ref_type"),
	refId: uuid("ref_id"),
	title: jsonb(),
	estMinutes: smallint("est_minutes"),
	status: planTaskStatusInLearn().default('pending').notNull(),
	evidence: jsonb(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	resultRef: jsonb("result_ref"),
}, (table) => [
	index("ix_plan_tasks_week_due").using("btree", table.planWeekId.asc().nullsLast().op("date_ops"), table.dueDate.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.planWeekId],
			foreignColumns: [planWeeksInLearn.id],
			name: "plan_tasks_plan_week_id_fkey"
		}).onDelete("cascade"),
]);

export const attemptsInLearn = learn.table("attempts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	programCode: text("program_code").notNull(),
	testSetId: uuid("test_set_id"),
	sectionId: uuid("section_id"),
	mode: attemptModeInLearn().notNull(),
	status: attemptStatusInLearn().default('in_progress').notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }),
	timeSpentSec: integer("time_spent_sec"),
	rawScore: numeric("raw_score", { precision: 7, scale:  2 }),
	scaledScore: numeric("scaled_score", { precision: 7, scale:  2 }),
	scoreBreakdown: jsonb("score_breakdown"),
	draftState: jsonb("draft_state"),
	device: jsonb(),
	tabLeaveCount: smallint("tab_leave_count").default(0).notNull(),
	planTaskId: uuid("plan_task_id"),
}, (table) => [
	index("ix_attempts_in_progress").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'in_progress'::learn.attempt_status)`),
	index("ix_attempts_test_set").using("btree", table.testSetId.asc().nullsLast().op("uuid_ops")),
	index("ix_attempts_user_started").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.startedAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "attempts_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "attempts_program_code_fkey"
		}),
	foreignKey({
			columns: [table.testSetId],
			foreignColumns: [testSetsInCatalog.id],
			name: "attempts_test_set_id_fkey"
		}),
	foreignKey({
			columns: [table.sectionId],
			foreignColumns: [sectionsInCatalog.id],
			name: "attempts_section_id_fkey"
		}),
	foreignKey({
			columns: [table.planTaskId],
			foreignColumns: [planTasksInLearn.id],
			name: "attempts_plan_task_id_fkey"
		}),
]);

export const recordingsInLearn = learn.table("recordings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	storageKey: text("storage_key").notNull(),
	mimeType: text("mime_type").notNull(),
	durationMs: integer("duration_ms"),
	sizeBytes: integer("size_bytes"),
	transcript: jsonb(),
	sttConfidence: numeric("stt_confidence", { precision: 4, scale:  3 }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_recordings_expiry").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(expires_at IS NOT NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "recordings_user_id_fkey"
		}).onDelete("cascade"),
]);

export const submissionsInLearn = learn.table("submissions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	programCode: text("program_code").notNull(),
	kind: submissionKindInLearn().notNull(),
	promptRefType: text("prompt_ref_type").notNull(),
	promptRefId: uuid("prompt_ref_id"),
	attemptId: uuid("attempt_id"),
	parentSubmissionId: uuid("parent_submission_id"),
	textBody: text("text_body"),
	recordingId: uuid("recording_id"),
	attachmentId: uuid("attachment_id"),
	wordCount: integer("word_count"),
	durationMs: integer("duration_ms"),
	status: submissionStatusInLearn().default('queued').notNull(),
	jobId: text("job_id"),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	gradedAt: timestamp("graded_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_submissions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")).where(sql`(status = ANY (ARRAY['queued'::learn.submission_status, 'processing'::learn.submission_status]))`),
	index("ix_submissions_user_created").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "submissions_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "submissions_program_code_fkey"
		}),
	foreignKey({
			columns: [table.attemptId],
			foreignColumns: [attemptsInLearn.id],
			name: "submissions_attempt_id_fkey"
		}),
	foreignKey({
			columns: [table.parentSubmissionId],
			foreignColumns: [table.id],
			name: "submissions_parent_submission_id_fkey"
		}),
	foreignKey({
			columns: [table.recordingId],
			foreignColumns: [recordingsInLearn.id],
			name: "submissions_recording_id_fkey"
		}),
	foreignKey({
			columns: [table.attachmentId],
			foreignColumns: [mediaAssetsInCatalog.id],
			name: "submissions_attachment_id_fkey"
		}),
]);

export const gradingResultsInLearn = learn.table("grading_results", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	submissionId: uuid("submission_id").notNull(),
	rubricCode: text("rubric_code").notNull(),
	overallScore: numeric("overall_score", { precision: 6, scale:  2 }),
	criterionScores: jsonb("criterion_scores").notNull(),
	feedback: jsonb().notNull(),
	errors: jsonb().default([]).notNull(),
	modelAnswer: text("model_answer"),
	modelAnswerMeta: jsonb("model_answer_meta"),
	confidence: text().default('normal').notNull(),
	promptVersionId: uuid("prompt_version_id"),
	aiTaskId: uuid("ai_task_id"),
	gradedAt: timestamp("graded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submissionsInLearn.id],
			name: "grading_results_submission_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.promptVersionId],
			foreignColumns: [promptVersionsInAi.id],
			name: "fk_grading_prompt_version"
		}),
	unique("grading_results_submission_id_key").on(table.submissionId),
]);

export const pronunciationScoresInLearn = learn.table("pronunciation_scores", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	submissionId: uuid("submission_id").notNull(),
	accuracy: numeric({ precision: 5, scale:  2 }),
	fluency: numeric({ precision: 5, scale:  2 }),
	prosody: numeric({ precision: 5, scale:  2 }),
	completeness: numeric({ precision: 5, scale:  2 }),
	overall: numeric({ precision: 5, scale:  2 }),
	words: jsonb().default([]).notNull(),
	tones: jsonb(),
	pitchContour: jsonb("pitch_contour"),
	provider: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submissionsInLearn.id],
			name: "pronunciation_scores_submission_id_fkey"
		}).onDelete("cascade"),
]);

export const phrasingFixesInLearn = learn.table("phrasing_fixes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gradingResultId: uuid("grading_result_id").notNull(),
	errorIndex: smallint("error_index").notNull(),
	userRewrite: text("user_rewrite"),
	verdict: text(),
	aiNote: text("ai_note"),
	carriedOver: boolean("carried_over").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gradingResultId],
			foreignColumns: [gradingResultsInLearn.id],
			name: "phrasing_fixes_grading_result_id_fkey"
		}).onDelete("cascade"),
]);

export const errorLogEntriesInLearn = learn.table("error_log_entries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	programCode: text("program_code").notNull(),
	attemptAnswerId: uuid("attempt_answer_id"),
	submissionId: uuid("submission_id"),
	questionId: uuid("question_id"),
	subskillId: uuid("subskill_id"),
	errorKind: errorKindInLearn("error_kind").notNull(),
	reasonAuto: jsonb("reason_auto"),
	reasonOverride: errorKindInLearn("reason_override"),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_error_log_user_recent").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.programCode.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "error_log_entries_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "error_log_entries_program_code_fkey"
		}),
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submissionsInLearn.id],
			name: "error_log_entries_submission_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questionsInCatalog.id],
			name: "error_log_entries_question_id_fkey"
		}),
	foreignKey({
			columns: [table.subskillId],
			foreignColumns: [subskillsInCatalog.id],
			name: "error_log_entries_subskill_id_fkey"
		}),
]);

export const srsCardsInLearn = learn.table("srs_cards", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	programCode: text("program_code").notNull(),
	cardType: srsCardTypeInLearn("card_type").notNull(),
	refId: uuid("ref_id").notNull(),
	sourceType: text("source_type"),
	sourceId: uuid("source_id"),
	state: srsStateInLearn().default('new').notNull(),
	stability: real(),
	difficulty: real(),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastReviewAt: timestamp("last_review_at", { withTimezone: true, mode: 'string' }),
	reps: integer().default(0).notNull(),
	lapses: integer().default(0).notNull(),
	suspended: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_srs_cards_due").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.programCode.asc().nullsLast().op("uuid_ops"), table.dueAt.asc().nullsLast().op("uuid_ops")).where(sql`(NOT suspended)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "srs_cards_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "srs_cards_program_code_fkey"
		}),
	unique("srs_cards_user_id_card_type_ref_id_key").on(table.userId, table.cardType, table.refId),
]);

export const srsReviewsInLearn = learn.table("srs_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	cardId: uuid("card_id").notNull(),
	rating: smallint().notNull(),
	reviewMode: text("review_mode"),
	elapsedDays: real("elapsed_days"),
	scheduledDays: real("scheduled_days"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_srs_reviews_card").using("btree", table.cardId.asc().nullsLast().op("timestamptz_ops"), table.reviewedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.cardId],
			foreignColumns: [srsCardsInLearn.id],
			name: "srs_reviews_card_id_fkey"
		}).onDelete("cascade"),
]);

export const notesInLearn = learn.table("notes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	testSetId: uuid("test_set_id"),
	questionId: uuid("question_id"),
	body: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_notes_user_test").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.testSetId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "notes_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.testSetId],
			foreignColumns: [testSetsInCatalog.id],
			name: "notes_test_set_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questionsInCatalog.id],
			name: "notes_question_id_fkey"
		}).onDelete("cascade"),
]);

export const streaksInLearn = learn.table("streaks", {
	userId: uuid("user_id").primaryKey().notNull(),
	currentStreak: integer("current_streak").default(0).notNull(),
	longestStreak: integer("longest_streak").default(0).notNull(),
	lastActiveDate: date("last_active_date"),
	freezeAvailableAt: date("freeze_available_at"),
	freezesUsed: integer("freezes_used").default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "streaks_user_id_fkey"
		}).onDelete("cascade"),
]);

export const xpEventsInLearn = learn.table("xp_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	kind: text().notNull(),
	amount: integer().notNull(),
	refType: text("ref_type"),
	refId: uuid("ref_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_xp_events_user_date").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "xp_events_user_id_fkey"
		}).onDelete("cascade"),
]);

export const badgesInLearn = learn.table("badges", {
	code: text().primaryKey().notNull(),
	name: jsonb().notNull(),
	rule: jsonb().notNull(),
});

export const scoreForecastsInLearn = learn.table("score_forecasts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	enrollmentId: uuid("enrollment_id").notNull(),
	predictedScore: numeric("predicted_score", { precision: 6, scale:  2 }).notNull(),
	ciLow: numeric("ci_low", { precision: 6, scale:  2 }),
	ciHigh: numeric("ci_high", { precision: 6, scale:  2 }),
	readyDate: date("ready_date"),
	modelVersion: text("model_version").notNull(),
	computedAt: timestamp("computed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_score_forecasts_enrollment").using("btree", table.enrollmentId.asc().nullsLast().op("timestamptz_ops"), table.computedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.enrollmentId],
			foreignColumns: [enrollmentsInLearn.id],
			name: "score_forecasts_enrollment_id_fkey"
		}).onDelete("cascade"),
]);

export const chatThreadsInLearn = learn.table("chat_threads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	programCode: text("program_code"),
	context: jsonb(),
	title: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_chat_threads_user").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "chat_threads_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "chat_threads_program_code_fkey"
		}),
]);

export const chatMessagesInLearn = learn.table("chat_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	threadId: uuid("thread_id").notNull(),
	role: text().notNull(),
	content: jsonb().notNull(),
	aiTaskId: uuid("ai_task_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_chat_messages_thread").using("btree", table.threadId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.threadId],
			foreignColumns: [chatThreadsInLearn.id],
			name: "chat_messages_thread_id_fkey"
		}).onDelete("cascade"),
]);

export const promptTemplatesInAi = ai.table("prompt_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	programCode: text("program_code"),
	description: text(),
}, (table) => [
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "prompt_templates_program_code_fkey"
		}),
	unique("prompt_templates_code_program_code_key").on(table.code, table.programCode),
]);

export const promptVersionsInAi = ai.table("prompt_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	templateId: uuid("template_id").notNull(),
	versionNo: integer("version_no").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	userTemplate: text("user_template").notNull(),
	fewShots: jsonb("few_shots").default([]).notNull(),
	rubric: jsonb(),
	outputSchema: jsonb("output_schema").notNull(),
	modelPolicy: jsonb("model_policy").notNull(),
	status: promptStatusInAi().default('draft').notNull(),
	canaryPercent: smallint("canary_percent").default(0).notNull(),
	evalRunId: uuid("eval_run_id"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_prompt_versions_active").using("btree", table.templateId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['active'::ai.prompt_status, 'canary'::ai.prompt_status]))`),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [promptTemplatesInAi.id],
			name: "prompt_versions_template_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [usersInIam.id],
			name: "prompt_versions_created_by_fkey"
		}),
	unique("prompt_versions_template_id_version_no_key").on(table.templateId, table.versionNo),
]);

export const modelRoutesInAi = ai.table("model_routes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	taskCode: text("task_code").notNull(),
	primaryModel: text("primary_model").notNull(),
	fallbackModels: text("fallback_models").array().default([""]).notNull(),
	params: jsonb().default({}).notNull(),
	timeoutMs: integer("timeout_ms").default(30000).notNull(),
	maxCostUsd: numeric("max_cost_usd", { precision: 8, scale:  4 }),
	creditsCost: integer("credits_cost").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("model_routes_task_code_key").on(table.taskCode),
]);

export const explanationCacheInAi = ai.table("explanation_cache", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	questionVersionId: uuid("question_version_id").notNull(),
	chosenOption: text("chosen_option").notNull(),
	locale: text().notNull(),
	content: jsonb().notNull(),
	promptVersionId: uuid("prompt_version_id"),
	hitCount: integer("hit_count").default(0).notNull(),
	qualityScore: numeric("quality_score", { precision: 3, scale:  2 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.questionVersionId],
			foreignColumns: [questionVersionsInCatalog.id],
			name: "explanation_cache_question_version_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.promptVersionId],
			foreignColumns: [promptVersionsInAi.id],
			name: "explanation_cache_prompt_version_id_fkey"
		}),
	unique("explanation_cache_question_version_id_chosen_option_locale_key").on(table.questionVersionId, table.chosenOption, table.locale),
]);

export const translationCacheInAi = ai.table("translation_cache", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sourceHash: text("source_hash").notNull(),
	sourceLang: text("source_lang").notNull(),
	targetLang: text("target_lang").notNull(),
	text: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("translation_cache_source_hash_source_lang_target_lang_key").on(table.sourceHash, table.sourceLang, table.targetLang),
]);

export const ttsCacheInAi = ai.table("tts_cache", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	textHash: text("text_hash").notNull(),
	voice: text().notNull(),
	storageKey: text("storage_key").notNull(),
	durationMs: integer("duration_ms"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("tts_cache_text_hash_voice_key").on(table.textHash, table.voice),
]);

export const evalSetsInAi = ai.table("eval_sets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	taskCode: text("task_code").notNull(),
	programCode: text("program_code"),
	name: text().notNull(),
	description: text(),
	thresholds: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "eval_sets_program_code_fkey"
		}),
]);

export const evalItemsInAi = ai.table("eval_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	evalSetId: uuid("eval_set_id").notNull(),
	input: jsonb().notNull(),
	gold: jsonb().notNull(),
	notes: text(),
}, (table) => [
	foreignKey({
			columns: [table.evalSetId],
			foreignColumns: [evalSetsInAi.id],
			name: "eval_items_eval_set_id_fkey"
		}).onDelete("cascade"),
]);

export const evalRunsInAi = ai.table("eval_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	evalSetId: uuid("eval_set_id").notNull(),
	promptVersionId: uuid("prompt_version_id").notNull(),
	model: text().notNull(),
	metrics: jsonb().notNull(),
	passed: boolean().notNull(),
	runAt: timestamp("run_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	triggeredBy: text("triggered_by"),
}, (table) => [
	foreignKey({
			columns: [table.evalSetId],
			foreignColumns: [evalSetsInAi.id],
			name: "eval_runs_eval_set_id_fkey"
		}),
	foreignKey({
			columns: [table.promptVersionId],
			foreignColumns: [promptVersionsInAi.id],
			name: "eval_runs_prompt_version_id_fkey"
		}),
]);

export const feedbackInAi = ai.table("feedback", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	aiTaskId: uuid("ai_task_id").notNull(),
	rating: text().notNull(),
	comment: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "feedback_user_id_fkey"
		}).onDelete("cascade"),
]);

export const embeddingsInAi = ai.table("embeddings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id").notNull(),
	model: text().notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_embeddings_hnsw").using("hnsw", table.embedding.asc().nullsLast().op("vector_cosine_ops")),
	unique("embeddings_entity_type_entity_id_model_key").on(table.entityType, table.entityId, table.model),
]);

export const plansInBilling = billing.table("plans", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	kind: planKindInBilling().notNull(),
	programCodes: text("program_codes").array().default([""]).notNull(),
	name: jsonb().notNull(),
	description: jsonb(),
	creditsIncluded: integer("credits_included").default(0).notNull(),
	creditsPeriod: text("credits_period"),
	durationDays: integer("duration_days"),
	features: jsonb().default({}).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: smallint("sort_order").default(0).notNull(),
}, (table) => [
	unique("plans_code_key").on(table.code),
]);

export const pricesInBilling = billing.table("prices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	planId: uuid("plan_id").notNull(),
	currency: char({ length: 3 }).default('VND').notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	compareAt: numeric("compare_at", { precision: 14, scale:  2 }),
	region: text().default('VN').notNull(),
	validFrom: timestamp("valid_from", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	validTo: timestamp("valid_to", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_prices_plan_valid").using("btree", table.planId.asc().nullsLast().op("uuid_ops"), table.validFrom.asc().nullsLast().op("timestamptz_ops"), table.validTo.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plansInBilling.id],
			name: "prices_plan_id_fkey"
		}).onDelete("cascade"),
]);

export const ordersInBilling = billing.table("orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	orgId: uuid("org_id"),
	planId: uuid("plan_id").notNull(),
	priceId: uuid("price_id").notNull(),
	promotionId: uuid("promotion_id"),
	quantity: integer().default(1).notNull(),
	currency: char({ length: 3 }).notNull(),
	subtotal: numeric({ precision: 14, scale:  2 }).notNull(),
	discount: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 14, scale:  2 }).notNull(),
	status: orderStatusInBilling().default('pending').notNull(),
	idempotencyKey: text("idempotency_key").notNull(),
	buyerInfo: jsonb("buyer_info"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_orders_user_created").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "orders_user_id_fkey"
		}),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizationsInIam.id],
			name: "orders_org_id_fkey"
		}),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plansInBilling.id],
			name: "orders_plan_id_fkey"
		}),
	foreignKey({
			columns: [table.priceId],
			foreignColumns: [pricesInBilling.id],
			name: "orders_price_id_fkey"
		}),
	foreignKey({
			columns: [table.promotionId],
			foreignColumns: [promotionsInBilling.id],
			name: "orders_promotion_id_fkey"
		}),
	unique("orders_idempotency_key_key").on(table.idempotencyKey),
]);

export const promotionsInBilling = billing.table("promotions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	kind: text().notNull(),
	value: numeric({ precision: 14, scale:  2 }).notNull(),
	planIds: uuid("plan_ids").array(),
	validFrom: timestamp("valid_from", { withTimezone: true, mode: 'string' }).notNull(),
	validTo: timestamp("valid_to", { withTimezone: true, mode: 'string' }).notNull(),
	maxUses: integer("max_uses"),
	usedCount: integer("used_count").default(0).notNull(),
	perUserLimit: smallint("per_user_limit").default(1).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	unique("promotions_code_key").on(table.code),
]);

export const paymentsInBilling = billing.table("payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	provider: paymentProviderInBilling().notNull(),
	providerTxnId: text("provider_txn_id"),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	currency: char({ length: 3 }).notNull(),
	status: text().notNull(),
	rawCallback: jsonb("raw_callback"),
	signatureValid: boolean("signature_valid"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_payments_order").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [ordersInBilling.id],
			name: "payments_order_id_fkey"
		}),
	unique("payments_provider_provider_txn_id_key").on(table.provider, table.providerTxnId),
]);

export const subscriptionsInBilling = billing.table("subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	orgId: uuid("org_id"),
	planId: uuid("plan_id").notNull(),
	programCode: text("program_code"),
	status: subscriptionStatusInBilling().notNull(),
	currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: 'string' }).notNull(),
	currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: 'string' }),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
	providerTokenRef: text("provider_token_ref"),
	sourceOrderId: uuid("source_order_id"),
	seats: integer(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_subscriptions_period_end").using("btree", table.currentPeriodEnd.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'active'::billing.subscription_status)`),
	index("ix_subscriptions_user_status").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "subscriptions_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizationsInIam.id],
			name: "subscriptions_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plansInBilling.id],
			name: "subscriptions_plan_id_fkey"
		}),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "subscriptions_program_code_fkey"
		}),
	foreignKey({
			columns: [table.sourceOrderId],
			foreignColumns: [ordersInBilling.id],
			name: "subscriptions_source_order_id_fkey"
		}),
	check("subscriptions_check", sql`(user_id IS NOT NULL) OR (org_id IS NOT NULL)`),
]);

export const entitlementsInBilling = billing.table("entitlements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	programCode: text("program_code"),
	featureCode: text("feature_code").notNull(),
	source: text().notNull(),
	sourceId: uuid("source_id"),
	validFrom: timestamp("valid_from", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	validTo: timestamp("valid_to", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_entitlements_user_valid").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.featureCode.asc().nullsLast().op("timestamptz_ops"), table.validTo.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "entitlements_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "entitlements_program_code_fkey"
		}),
	unique("entitlements_user_id_program_code_feature_code_source_sourc_key").on(table.userId, table.programCode, table.featureCode, table.source, table.sourceId),
]);

export const quotasInBilling = billing.table("quotas", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	planKind: planKindInBilling("plan_kind").notNull(),
	featureCode: text("feature_code").notNull(),
	period: quotaPeriodInBilling().notNull(),
	limitValue: integer("limit_value").notNull(),
}, (table) => [
	unique("quotas_plan_kind_feature_code_period_key").on(table.planKind, table.featureCode, table.period),
]);

export const creditLedgerInBilling = billing.table("credit_ledger", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	userId: uuid("user_id"),
	orgId: uuid("org_id"),
	delta: integer().notNull(),
	balanceAfter: integer("balance_after").notNull(),
	reason: creditReasonInBilling().notNull(),
	refType: text("ref_type"),
	refId: uuid("ref_id"),
	aiTaskId: uuid("ai_task_id"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_credit_ledger_org_created").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("ix_credit_ledger_user_created").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "credit_ledger_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizationsInIam.id],
			name: "credit_ledger_org_id_fkey"
		}).onDelete("cascade"),
	check("credit_ledger_check", sql`(user_id IS NOT NULL) OR (org_id IS NOT NULL)`),
]);

export const invoicesInBilling = billing.table("invoices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	provider: text().notNull(),
	series: text(),
	invoiceNo: text("invoice_no"),
	lookupCode: text("lookup_code"),
	status: text().notNull(),
	pdfUrl: text("pdf_url"),
	raw: jsonb(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [ordersInBilling.id],
			name: "invoices_order_id_fkey"
		}),
	unique("invoices_order_id_key").on(table.orderId),
]);

export const reconciliationRunsInBilling = billing.table("reconciliation_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider: paymentProviderInBilling().notNull(),
	forDate: date("for_date").notNull(),
	expectedTotal: numeric("expected_total", { precision: 14, scale:  2 }),
	actualTotal: numeric("actual_total", { precision: 14, scale:  2 }),
	mismatches: jsonb().default([]).notNull(),
	status: text().notNull(),
	runAt: timestamp("run_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("reconciliation_runs_provider_for_date_key").on(table.provider, table.forDate),
]);

export const featureFlagsInBilling = billing.table("feature_flags", {
	key: text().primaryKey().notNull(),
	enabled: boolean().default(false).notNull(),
	rules: jsonb().default({}).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const notificationsInOps = ops.table("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	channel: notificationChannelInOps().notNull(),
	templateCode: text("template_code").notNull(),
	payload: jsonb().default({}).notNull(),
	status: text().default('scheduled').notNull(),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	error: text(),
}, (table) => [
	index("ix_notifications_due").using("btree", table.scheduledAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'scheduled'::text)`),
	index("ix_notifications_user_status").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.status.asc().nullsLast().op("timestamptz_ops"), table.scheduledAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "notifications_user_id_fkey"
		}).onDelete("cascade"),
]);

export const notificationPreferencesInOps = ops.table("notification_preferences", {
	userId: uuid("user_id").primaryKey().notNull(),
	channels: jsonb().default({"push":true,"zalo":false,"email":true,"inapp":true}).notNull(),
	quietHours: jsonb("quiet_hours").default({"end":"07:00","start":"22:00"}).notNull(),
	reminderTimes: text("reminder_times").array().default(["20:00"]).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "notification_preferences_user_id_fkey"
		}).onDelete("cascade"),
]);

export const feedbackInOps = ops.table("feedback", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	kind: text().notNull(),
	body: text().notNull(),
	page: text(),
	context: jsonb(),
	status: text().default('new').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "feedback_user_id_fkey"
		}).onDelete("set null"),
]);

export const contentReportsInOps = ops.table("content_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id").notNull(),
	reason: text().notNull(),
	status: text().default('open').notNull(),
	resolvedBy: uuid("resolved_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_content_reports_entity").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "content_reports_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.resolvedBy],
			foreignColumns: [usersInIam.id],
			name: "content_reports_resolved_by_fkey"
		}),
]);

export const supportTicketsInOps = ops.table("support_tickets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	subject: text().notNull(),
	body: text(),
	channel: text(),
	status: text().default('open').notNull(),
	priority: text().default('normal').notNull(),
	assignedTo: uuid("assigned_to"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "support_tickets_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [usersInIam.id],
			name: "support_tickets_assigned_to_fkey"
		}),
]);

export const jobsDeadletterInOps = ops.table("jobs_deadletter", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	queue: text().notNull(),
	jobId: text("job_id").notNull(),
	payload: jsonb(),
	error: text(),
	attempts: smallint(),
	failedAt: timestamp("failed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const classesInIam = iam.table("classes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: text().notNull(),
	programCode: text("program_code"),
	teacherUserId: uuid("teacher_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizationsInIam.id],
			name: "classes_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.teacherUserId],
			foreignColumns: [usersInIam.id],
			name: "classes_teacher_user_id_fkey"
		}),
	pgPolicy("org_scope_classes", { as: "permissive", for: "all", to: ["public"], using: sql`((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true)))` }),
]);

export const assignmentsInLearn = learn.table("assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	classId: uuid("class_id").notNull(),
	createdBy: uuid("created_by").notNull(),
	title: text().notNull(),
	taskType: planTaskTypeInLearn("task_type").notNull(),
	refType: text("ref_type"),
	refId: uuid("ref_id"),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizationsInIam.id],
			name: "assignments_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classesInIam.id],
			name: "assignments_class_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [usersInIam.id],
			name: "assignments_created_by_fkey"
		}),
	pgPolicy("org_scope_assignments", { as: "permissive", for: "all", to: ["public"], using: sql`((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true)))` }),
]);

export const questionSubskillsInCatalog = catalog.table("question_subskills", {
	questionId: uuid("question_id").notNull(),
	subskillId: uuid("subskill_id").notNull(),
	weight: numeric({ precision: 4, scale:  2 }).default('1').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questionsInCatalog.id],
			name: "question_subskills_question_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.subskillId],
			foreignColumns: [subskillsInCatalog.id],
			name: "question_subskills_subskill_id_fkey"
		}),
	primaryKey({ columns: [table.questionId, table.subskillId], name: "question_subskills_pkey"}),
]);

export const vocabListItemsInCatalog = catalog.table("vocab_list_items", {
	listId: uuid("list_id").notNull(),
	vocabItemId: uuid("vocab_item_id").notNull(),
	sortOrder: integer("sort_order").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.listId],
			foreignColumns: [vocabListsInCatalog.id],
			name: "vocab_list_items_list_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.vocabItemId],
			foreignColumns: [vocabItemsInCatalog.id],
			name: "vocab_list_items_vocab_item_id_fkey"
		}),
	primaryKey({ columns: [table.listId, table.vocabItemId], name: "vocab_list_items_pkey"}),
]);

export const userBadgesInLearn = learn.table("user_badges", {
	userId: uuid("user_id").notNull(),
	badgeCode: text("badge_code").notNull(),
	earnedAt: timestamp("earned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "user_badges_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.badgeCode],
			foreignColumns: [badgesInLearn.code],
			name: "user_badges_badge_code_fkey"
		}),
	primaryKey({ columns: [table.userId, table.badgeCode], name: "user_badges_pkey"}),
]);

export const testSetSectionsInCatalog = catalog.table("test_set_sections", {
	testSetId: uuid("test_set_id").notNull(),
	sectionId: uuid("section_id").notNull(),
	sortOrder: smallint("sort_order").notNull(),
	durationSec: integer("duration_sec"),
}, (table) => [
	foreignKey({
			columns: [table.testSetId],
			foreignColumns: [testSetsInCatalog.id],
			name: "test_set_sections_test_set_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sectionId],
			foreignColumns: [sectionsInCatalog.id],
			name: "test_set_sections_section_id_fkey"
		}),
	primaryKey({ columns: [table.testSetId, table.sectionId], name: "test_set_sections_pkey"}),
]);

export const evalRunItemsInAi = ai.table("eval_run_items", {
	runId: uuid("run_id").notNull(),
	evalItemId: uuid("eval_item_id").notNull(),
	output: jsonb().notNull(),
	diff: numeric({ precision: 6, scale:  3 }),
}, (table) => [
	foreignKey({
			columns: [table.runId],
			foreignColumns: [evalRunsInAi.id],
			name: "eval_run_items_run_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.evalItemId],
			foreignColumns: [evalItemsInAi.id],
			name: "eval_run_items_eval_item_id_fkey"
		}),
	primaryKey({ columns: [table.runId, table.evalItemId], name: "eval_run_items_pkey"}),
]);

export const creditBalancesInBilling = billing.table("credit_balances", {
	ownerType: text("owner_type").notNull(),
	ownerId: uuid("owner_id").notNull(),
	balance: integer().default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.ownerType, table.ownerId], name: "credit_balances_pkey"}),
	check("credit_balances_balance_check", sql`balance >= 0`),
]);

export const assignmentSubmissionsInLearn = learn.table("assignment_submissions", {
	assignmentId: uuid("assignment_id").notNull(),
	userId: uuid("user_id").notNull(),
	resultRef: jsonb("result_ref"),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.assignmentId],
			foreignColumns: [assignmentsInLearn.id],
			name: "assignment_submissions_assignment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "assignment_submissions_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.assignmentId, table.userId], name: "assignment_submissions_pkey"}),
	pgPolicy("org_scope_assignment_submissions", { as: "permissive", for: "all", to: ["public"], using: sql`((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((user_id)::text = current_setting('app.user_id'::text, true)) OR (EXISTS ( SELECT 1
   FROM learn.assignments a
  WHERE ((a.id = assignment_submissions.assignment_id) AND ((a.org_id)::text = current_setting('app.org_id'::text, true))))))` }),
]);

export const shadowingProgressInLearn = learn.table("shadowing_progress", {
	userId: uuid("user_id").notNull(),
	videoId: uuid("video_id").notNull(),
	sentencesDone: integer("sentences_done").default(0).notNull(),
	bestScores: jsonb("best_scores").default({}).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "shadowing_progress_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.videoId],
			foreignColumns: [videosInCatalog.id],
			name: "shadowing_progress_video_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.videoId], name: "shadowing_progress_pkey"}),
]);

export const usageCountersInBilling = billing.table("usage_counters", {
	userId: uuid("user_id").notNull(),
	featureCode: text("feature_code").notNull(),
	periodKey: text("period_key").notNull(),
	used: integer().default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "usage_counters_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.featureCode, table.periodKey], name: "usage_counters_pkey"}),
]);

export const orgMembershipsInIam = iam.table("org_memberships", {
	orgId: uuid("org_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: orgRoleInIam().notNull(),
	classId: uuid("class_id"),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_org_memberships_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizationsInIam.id],
			name: "org_memberships_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "org_memberships_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classesInIam.id],
			name: "org_memberships_class_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.orgId, table.userId], name: "org_memberships_pkey"}),
	pgPolicy("org_scope_memberships", { as: "permissive", for: "all", to: ["public"], using: sql`((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true)) OR ((user_id)::text = current_setting('app.user_id'::text, true)))` }),
]);

export const testSetItemsInCatalog = catalog.table("test_set_items", {
	testSetId: uuid("test_set_id").notNull(),
	questionId: uuid("question_id").notNull(),
	sectionId: uuid("section_id").notNull(),
	sortOrder: smallint("sort_order").notNull(),
	groupKey: text("group_key"),
	points: numeric({ precision: 5, scale:  2 }).default('1').notNull(),
}, (table) => [
	index("ix_test_set_items_order").using("btree", table.testSetId.asc().nullsLast().op("uuid_ops"), table.sectionId.asc().nullsLast().op("uuid_ops"), table.sortOrder.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.testSetId],
			foreignColumns: [testSetsInCatalog.id],
			name: "test_set_items_test_set_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questionsInCatalog.id],
			name: "test_set_items_question_id_fkey"
		}),
	foreignKey({
			columns: [table.sectionId],
			foreignColumns: [sectionsInCatalog.id],
			name: "test_set_items_section_id_fkey"
		}),
	primaryKey({ columns: [table.testSetId, table.questionId], name: "test_set_items_pkey"}),
]);

export const skillMasteryInLearn = learn.table("skill_mastery", {
	userId: uuid("user_id").notNull(),
	programCode: text("program_code").notNull(),
	subskillId: uuid("subskill_id").notNull(),
	mastery: numeric({ precision: 5, scale:  4 }).default('0').notNull(),
	confidence: numeric({ precision: 5, scale:  4 }),
	nObs: integer("n_obs").default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "skill_mastery_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programCode],
			foreignColumns: [programsInCatalog.code],
			name: "skill_mastery_program_code_fkey"
		}),
	foreignKey({
			columns: [table.subskillId],
			foreignColumns: [subskillsInCatalog.id],
			name: "skill_mastery_subskill_id_fkey"
		}),
	primaryKey({ columns: [table.userId, table.subskillId], name: "skill_mastery_pkey"}),
]);

export const lessonProgressInLearn = learn.table("lesson_progress", {
	userId: uuid("user_id").notNull(),
	lessonId: uuid("lesson_id").notNull(),
	status: text().default('in_progress').notNull(),
	currentStep: smallint("current_step").default(1).notNull(),
	score: numeric({ precision: 5, scale:  2 }),
	chatThreadId: uuid("chat_thread_id"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInIam.id],
			name: "lesson_progress_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.lessonId],
			foreignColumns: [lessonsInCatalog.id],
			name: "lesson_progress_lesson_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.lessonId], name: "lesson_progress_pkey"}),
]);
export const vUserProgramSummaryInLearn = learn.view("v_user_program_summary", {	userId: uuid("user_id"),
	programCode: text("program_code"),
	targetScore: numeric("target_score", { precision: 6, scale:  2 }),
	examDate: date("exam_date"),
	lastScaledScore: numeric("last_scaled_score", { precision: 7, scale:  2 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	cardsDue: bigint("cards_due", { mode: "number" }),
	currentStreak: integer("current_streak"),
}).as(sql`SELECT e.user_id, e.program_code, e.target_score, e.exam_date, ( SELECT a.scaled_score FROM learn.attempts a WHERE a.user_id = e.user_id AND a.program_code = e.program_code AND a.status = 'graded'::learn.attempt_status AND (a.mode = ANY (ARRAY['exam'::learn.attempt_mode, 'diagnostic'::learn.attempt_mode])) ORDER BY a.submitted_at DESC LIMIT 1) AS last_scaled_score, ( SELECT count(*) AS count FROM learn.srs_cards c WHERE c.user_id = e.user_id AND c.program_code = e.program_code AND c.due_at <= now() AND NOT c.suspended) AS cards_due, s.current_streak FROM learn.enrollments e LEFT JOIN learn.streaks s ON s.user_id = e.user_id WHERE e.is_active`);

export const vActiveEntitlementsInBilling = billing.view("v_active_entitlements", {	userId: uuid("user_id"),
	programCode: text("program_code"),
	featureCode: text("feature_code"),
	validFrom: timestamp("valid_from", { withTimezone: true, mode: 'string' }),
	validTo: timestamp("valid_to", { withTimezone: true, mode: 'string' }),
}).as(sql`SELECT user_id, program_code, feature_code, min(valid_from) AS valid_from, max(valid_to) AS valid_to FROM billing.entitlements WHERE valid_from <= now() AND (valid_to IS NULL OR valid_to > now()) GROUP BY user_id, program_code, feature_code`);