-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE SCHEMA "iam";
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE SCHEMA "learn";
--> statement-breakpoint
CREATE SCHEMA "ai";
--> statement-breakpoint
CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TYPE "ai"."prompt_status" AS ENUM('draft', 'canary', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "ai"."task_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'timeout', 'refused');--> statement-breakpoint
CREATE TYPE "billing"."credit_reason" AS ENUM('purchase', 'subscription_grant', 'referral', 'promo', 'consume', 'refund', 'expire', 'admin_adjust', 'b2b_pool');--> statement-breakpoint
CREATE TYPE "billing"."order_status" AS ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded', 'expired');--> statement-breakpoint
CREATE TYPE "billing"."payment_provider" AS ENUM('vnpay', 'momo', 'zalopay', 'payos', 'stripe', 'bank_transfer', 'manual');--> statement-breakpoint
CREATE TYPE "billing"."plan_kind" AS ENUM('free', 'monthly', 'yearly', 'lifetime', 'combo', 'credit_pack', 'b2b_seat');--> statement-breakpoint
CREATE TYPE "billing"."quota_period" AS ENUM('day', 'month', 'lifetime');--> statement-breakpoint
CREATE TYPE "billing"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled', 'expired', 'lifetime');--> statement-breakpoint
CREATE TYPE "catalog"."content_source" AS ENUM('human', 'ai', 'licensed', 'user_submitted');--> statement-breakpoint
CREATE TYPE "catalog"."content_status" AS ENUM('draft', 'ai_checked', 'review1', 'review2', 'published', 'retired', 'rejected');--> statement-breakpoint
CREATE TYPE "catalog"."difficulty" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'N5', 'N4', 'N3', 'N2', 'N1', 'HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7_9', 'mixed');--> statement-breakpoint
CREATE TYPE "catalog"."lesson_kind" AS ENUM('lesson', 'grammar', 'pronunciation', 'strategy');--> statement-breakpoint
CREATE TYPE "catalog"."media_kind" AS ENUM('audio', 'image', 'video_ref', 'document');--> statement-breakpoint
CREATE TYPE "catalog"."passage_kind" AS ENUM('reading_passage', 'audio_script', 'image_prompt', 'chart_prompt', 'dialogue');--> statement-breakpoint
CREATE TYPE "catalog"."review_decision" AS ENUM('approve', 'reject', 'needs_change');--> statement-breakpoint
CREATE TYPE "catalog"."review_stage" AS ENUM('ai_check', 'review1', 'review2');--> statement-breakpoint
CREATE TYPE "catalog"."test_set_kind" AS ENUM('full', 'mini', 'part_drill', 'diagnostic', 'topic_pack');--> statement-breakpoint
CREATE TYPE "catalog"."video_category" AS ENUM('mock_speaking', 'conversation', 'movie', 'story', 'lecture', 'anime', 'news', 'user_link');--> statement-breakpoint
CREATE TYPE "catalog"."vocab_kind" AS ENUM('word', 'collocation', 'phrasal_verb', 'kanji', 'hanzi', 'grammar_point');--> statement-breakpoint
CREATE TYPE "iam"."auth_provider" AS ENUM('email', 'phone', 'google', 'apple', 'facebook', 'zalo');--> statement-breakpoint
CREATE TYPE "iam"."consent_type" AS ENUM('terms', 'privacy', 'voice_processing', 'marketing', 'minor_guardian');--> statement-breakpoint
CREATE TYPE "iam"."org_role" AS ENUM('org_admin', 'teacher', 'learner');--> statement-breakpoint
CREATE TYPE "iam"."org_type" AS ENUM('school', 'center', 'company', 'other');--> statement-breakpoint
CREATE TYPE "iam"."referral_status" AS ENUM('joined', 'started', 'upgraded');--> statement-breakpoint
CREATE TYPE "iam"."user_status" AS ENUM('active', 'suspended', 'pending_deletion', 'deleted');--> statement-breakpoint
CREATE TYPE "learn"."attempt_mode" AS ENUM('exam', 'practice', 'diagnostic', 'drill', 'timed_drill');--> statement-breakpoint
CREATE TYPE "learn"."attempt_status" AS ENUM('in_progress', 'submitted', 'graded', 'abandoned');--> statement-breakpoint
CREATE TYPE "learn"."error_kind" AS ENUM('paraphrase', 'trap', 'vocabulary', 'timeout', 'grammar', 'listening_detail', 'inference', 'spelling', 'tone', 'pronunciation', 'other');--> statement-breakpoint
CREATE TYPE "learn"."plan_task_status" AS ENUM('pending', 'done', 'skipped', 'expired');--> statement-breakpoint
CREATE TYPE "learn"."plan_task_type" AS ENUM('full_test', 'part_drill', 'timed_drill', 'lesson', 'grammar', 'vocab_review', 'shadowing', 'dictation', 'writing', 'speaking', 'impromptu', 'checkin', 'review_errors');--> statement-breakpoint
CREATE TYPE "learn"."srs_card_type" AS ENUM('vocab', 'error', 'grammar', 'phoneme', 'sentence');--> statement-breakpoint
CREATE TYPE "learn"."srs_state" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "learn"."submission_kind" AS ENUM('writing', 'speaking', 'impromptu', 'shadowing_sentence', 'pronunciation', 'grammar_sentence', 'handwriting');--> statement-breakpoint
CREATE TYPE "learn"."submission_status" AS ENUM('queued', 'processing', 'graded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "ops"."notification_channel" AS ENUM('email', 'push', 'zalo', 'sms', 'inapp');--> statement-breakpoint
CREATE SEQUENCE "ops"."audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "ops"."outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "iam"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext",
	"phone" text,
	"password_hash" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"ui_locale" text DEFAULT 'vi' NOT NULL,
	"explain_locale" text DEFAULT 'vi' NOT NULL,
	"timezone" text DEFAULT 'Asia/Ho_Chi_Minh' NOT NULL,
	"status" "iam"."user_status" DEFAULT 'active' NOT NULL,
	"is_guest" boolean DEFAULT false NOT NULL,
	"birth_year" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_phone_key" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "iam"."auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "iam"."auth_provider" NOT NULL,
	"provider_uid" text NOT NULL,
	"email" "citext",
	"raw_profile" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_provider_uid_key" UNIQUE("provider","provider_uid")
);
--> statement-breakpoint
CREATE TABLE "iam"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"device" jsonb,
	"ip" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "sessions_refresh_token_hash_key" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "iam"."user_roles" (
	"user_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"program_code" text,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_code_program_code_key" UNIQUE("user_id","role_code","program_code")
);
--> statement-breakpoint
CREATE TABLE "iam"."roles" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "iam"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "iam"."org_type" NOT NULL,
	"tax_code" text,
	"domain" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referee_user_id" uuid,
	"code" text NOT NULL,
	"status" "iam"."referral_status" DEFAULT 'joined' NOT NULL,
	"device_fingerprint" text,
	"ip" "inet",
	"credited_join_at" timestamp with time zone,
	"credited_upgrade_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referee_user_id_key" UNIQUE("referee_user_id")
);
--> statement-breakpoint
CREATE TABLE "iam"."consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "iam"."consent_type" NOT NULL,
	"version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "iam"."deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"export_url" text
);
--> statement-breakpoint
CREATE TABLE "catalog"."programs" (
	"code" text PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"score_scale" jsonb NOT NULL,
	"languages" text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "skills_program_code_code_key" UNIQUE("program_code","code")
);
--> statement-breakpoint
CREATE TABLE "catalog"."sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"level" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"duration_sec" integer,
	"question_count" smallint,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "sections_program_code_code_level_key" UNIQUE("program_code","code","level")
);
--> statement-breakpoint
CREATE TABLE "catalog"."topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	CONSTRAINT "topics_program_code_code_key" UNIQUE("program_code","code")
);
--> statement-breakpoint
CREATE TABLE "catalog"."subskills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	CONSTRAINT "subskills_program_code_code_key" UNIQUE("program_code","code")
);
--> statement-breakpoint
CREATE TABLE "catalog"."media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "catalog"."media_kind" NOT NULL,
	"storage_key" text,
	"external_url" text,
	"mime_type" text,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"size_bytes" bigint,
	"license" text DEFAULT 'own' NOT NULL,
	"transcript" jsonb,
	"checksum" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."passages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"kind" "catalog"."passage_kind" NOT NULL,
	"title" text,
	"body" text,
	"media_asset_id" uuid,
	"word_count" integer,
	"difficulty" "catalog"."difficulty",
	"topic_id" uuid,
	"source" "catalog"."content_source" DEFAULT 'human' NOT NULL,
	"status" "catalog"."content_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"section_id" uuid NOT NULL,
	"question_type_code" text NOT NULL,
	"passage_id" uuid,
	"topic_id" uuid,
	"current_version_id" uuid,
	"status" "catalog"."content_status" DEFAULT 'draft' NOT NULL,
	"source" "catalog"."content_source" DEFAULT 'human' NOT NULL,
	"difficulty_target" "catalog"."difficulty",
	"irt_a" numeric(6, 3),
	"irt_b" numeric(6, 3),
	"irt_c" numeric(6, 3),
	"irt_fitted_at" timestamp with time zone,
	"exposure_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"avg_time_ms" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog"."question_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"content_schema" jsonb NOT NULL,
	"auto_gradable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."question_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"content" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_versions_question_id_version_no_key" UNIQUE("question_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "catalog"."test_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"code" text NOT NULL,
	"title" jsonb NOT NULL,
	"kind" "catalog"."test_set_kind" NOT NULL,
	"level" text,
	"is_free" boolean DEFAULT false NOT NULL,
	"duration_sec" integer,
	"year_tag" smallint,
	"status" "catalog"."content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_sets_program_code_code_key" UNIQUE("program_code","code")
);
--> statement-breakpoint
CREATE TABLE "catalog"."grammar_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"level" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "grammar_topics_program_code_code_key" UNIQUE("program_code","code")
);
--> statement-breakpoint
CREATE TABLE "catalog"."lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"skill_id" uuid,
	"section_id" uuid,
	"grammar_topic_id" uuid,
	"kind" "catalog"."lesson_kind" NOT NULL,
	"level" text,
	"title" jsonb NOT NULL,
	"summary" jsonb,
	"est_minutes" smallint,
	"is_free" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"status" "catalog"."content_status" DEFAULT 'draft' NOT NULL,
	"source" "catalog"."content_source" DEFAULT 'human' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."lesson_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"sort_order" smallint NOT NULL,
	"step_type" text NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "lesson_steps_lesson_id_sort_order_key" UNIQUE("lesson_id","sort_order")
);
--> statement-breakpoint
CREATE TABLE "catalog"."exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"lesson_id" uuid,
	"grammar_topic_id" uuid,
	"exercise_type" text NOT NULL,
	"content" jsonb NOT NULL,
	"answer" jsonb NOT NULL,
	"difficulty" "catalog"."difficulty",
	"status" "catalog"."content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"youtube_id" text NOT NULL,
	"title" text NOT NULL,
	"channel" text,
	"duration_sec" integer,
	"language" text NOT NULL,
	"category" "catalog"."video_category" NOT NULL,
	"level" text,
	"status" "catalog"."content_status" DEFAULT 'draft' NOT NULL,
	"submitted_by" uuid,
	"segment_job" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_program_code_youtube_id_key" UNIQUE("program_code","youtube_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."video_sentences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	"ipa" text,
	"reading" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "video_sentences_video_id_sort_order_key" UNIQUE("video_id","sort_order")
);
--> statement-breakpoint
CREATE TABLE "catalog"."vocab_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"kind" "catalog"."vocab_kind" DEFAULT 'word' NOT NULL,
	"headword" text NOT NULL,
	"reading" text,
	"sino_vietnamese" text,
	"pos" text,
	"ipa_uk" text,
	"ipa_us" text,
	"audio_uk_id" uuid,
	"audio_us_id" uuid,
	"meanings" jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"radicals" text[],
	"stroke_count" smallint,
	"level" text,
	"frequency_rank" integer,
	"source" "catalog"."content_source" DEFAULT 'human' NOT NULL,
	"status" "catalog"."content_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."vocab_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"kind" text NOT NULL,
	"title" jsonb NOT NULL,
	"test_set_id" uuid,
	"topic_id" uuid,
	"owner_user_id" uuid,
	"is_free" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."content_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"stage" "catalog"."review_stage" NOT NULL,
	"reviewer_id" uuid,
	"decision" "catalog"."review_decision" NOT NULL,
	"notes" text,
	"ai_report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program_code" text NOT NULL,
	"target_score" numeric(6, 2),
	"target_level" text,
	"exam_date" date,
	"daily_minutes" smallint DEFAULT 30 NOT NULL,
	"current_level" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_user_id_program_code_key" UNIQUE("user_id","program_code")
);
--> statement-breakpoint
CREATE TABLE "learn"."study_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"strategy" jsonb NOT NULL,
	"generated_by" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_plans_enrollment_id_version_no_key" UNIQUE("enrollment_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "learn"."plan_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"week_no" smallint NOT NULL,
	"start_date" date NOT NULL,
	"focus_skill_id" uuid,
	"focus_section_id" uuid,
	"load_minutes" smallint,
	"checkin_done_at" timestamp with time zone,
	"adjustment" jsonb,
	CONSTRAINT "plan_weeks_plan_id_week_no_key" UNIQUE("plan_id","week_no")
);
--> statement-breakpoint
CREATE TABLE "learn"."plan_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_week_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"task_type" "learn"."plan_task_type" NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"title" jsonb,
	"est_minutes" smallint,
	"status" "learn"."plan_task_status" DEFAULT 'pending' NOT NULL,
	"evidence" jsonb,
	"completed_at" timestamp with time zone,
	"result_ref" jsonb
);
--> statement-breakpoint
CREATE TABLE "learn"."attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program_code" text NOT NULL,
	"test_set_id" uuid,
	"section_id" uuid,
	"mode" "learn"."attempt_mode" NOT NULL,
	"status" "learn"."attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"time_spent_sec" integer,
	"raw_score" numeric(7, 2),
	"scaled_score" numeric(7, 2),
	"score_breakdown" jsonb,
	"draft_state" jsonb,
	"device" jsonb,
	"tab_leave_count" smallint DEFAULT 0 NOT NULL,
	"plan_task_id" uuid
);
--> statement-breakpoint
CREATE TABLE "learn"."recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"duration_ms" integer,
	"size_bytes" integer,
	"transcript" jsonb,
	"stt_confidence" numeric(4, 3),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program_code" text NOT NULL,
	"kind" "learn"."submission_kind" NOT NULL,
	"prompt_ref_type" text NOT NULL,
	"prompt_ref_id" uuid,
	"attempt_id" uuid,
	"parent_submission_id" uuid,
	"text_body" text,
	"recording_id" uuid,
	"attachment_id" uuid,
	"word_count" integer,
	"duration_ms" integer,
	"status" "learn"."submission_status" DEFAULT 'queued' NOT NULL,
	"job_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"graded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "learn"."grading_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"rubric_code" text NOT NULL,
	"overall_score" numeric(6, 2),
	"criterion_scores" jsonb NOT NULL,
	"feedback" jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_answer" text,
	"model_answer_meta" jsonb,
	"confidence" text DEFAULT 'normal' NOT NULL,
	"prompt_version_id" uuid,
	"ai_task_id" uuid,
	"graded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_results_submission_id_key" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "learn"."pronunciation_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"accuracy" numeric(5, 2),
	"fluency" numeric(5, 2),
	"prosody" numeric(5, 2),
	"completeness" numeric(5, 2),
	"overall" numeric(5, 2),
	"words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tones" jsonb,
	"pitch_contour" jsonb,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."phrasing_fixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grading_result_id" uuid NOT NULL,
	"error_index" smallint NOT NULL,
	"user_rewrite" text,
	"verdict" text,
	"ai_note" text,
	"carried_over" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."error_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program_code" text NOT NULL,
	"attempt_answer_id" uuid,
	"submission_id" uuid,
	"question_id" uuid,
	"subskill_id" uuid,
	"error_kind" "learn"."error_kind" NOT NULL,
	"reason_auto" jsonb,
	"reason_override" "learn"."error_kind",
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."srs_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program_code" text NOT NULL,
	"card_type" "learn"."srs_card_type" NOT NULL,
	"ref_id" uuid NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"state" "learn"."srs_state" DEFAULT 'new' NOT NULL,
	"stability" real,
	"difficulty" real,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_review_at" timestamp with time zone,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "srs_cards_user_id_card_type_ref_id_key" UNIQUE("user_id","card_type","ref_id")
);
--> statement-breakpoint
CREATE TABLE "learn"."srs_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"review_mode" text,
	"elapsed_days" real,
	"scheduled_days" real,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"test_set_id" uuid,
	"question_id" uuid,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_active_date" date,
	"freeze_available_at" date,
	"freezes_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."xp_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."badges" (
	"code" text PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"rule" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."score_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"predicted_score" numeric(6, 2) NOT NULL,
	"ci_low" numeric(6, 2),
	"ci_high" numeric(6, 2),
	"ready_date" date,
	"model_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program_code" text,
	"context" jsonb,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"ai_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"program_code" text,
	"description" text,
	CONSTRAINT "prompt_templates_code_program_code_key" UNIQUE("code","program_code")
);
--> statement-breakpoint
CREATE TABLE "ai"."prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"user_template" text NOT NULL,
	"few_shots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rubric" jsonb,
	"output_schema" jsonb NOT NULL,
	"model_policy" jsonb NOT NULL,
	"status" "ai"."prompt_status" DEFAULT 'draft' NOT NULL,
	"canary_percent" smallint DEFAULT 0 NOT NULL,
	"eval_run_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_template_id_version_no_key" UNIQUE("template_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "ai"."model_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_code" text NOT NULL,
	"primary_model" text NOT NULL,
	"fallback_models" text[] DEFAULT '{""}' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"max_cost_usd" numeric(8, 4),
	"credits_cost" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_routes_task_code_key" UNIQUE("task_code")
);
--> statement-breakpoint
CREATE TABLE "ai"."explanation_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_version_id" uuid NOT NULL,
	"chosen_option" text NOT NULL,
	"locale" text NOT NULL,
	"content" jsonb NOT NULL,
	"prompt_version_id" uuid,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"quality_score" numeric(3, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explanation_cache_question_version_id_chosen_option_locale_key" UNIQUE("question_version_id","chosen_option","locale")
);
--> statement-breakpoint
CREATE TABLE "ai"."translation_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_hash" text NOT NULL,
	"source_lang" text NOT NULL,
	"target_lang" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_cache_source_hash_source_lang_target_lang_key" UNIQUE("source_hash","source_lang","target_lang")
);
--> statement-breakpoint
CREATE TABLE "ai"."tts_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text_hash" text NOT NULL,
	"voice" text NOT NULL,
	"storage_key" text NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tts_cache_text_hash_voice_key" UNIQUE("text_hash","voice")
);
--> statement-breakpoint
CREATE TABLE "ai"."eval_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_code" text NOT NULL,
	"program_code" text,
	"name" text NOT NULL,
	"description" text,
	"thresholds" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."eval_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_set_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"gold" jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "ai"."eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_set_id" uuid NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"model" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triggered_by" text
);
--> statement-breakpoint
CREATE TABLE "ai"."feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_task_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_entity_type_entity_id_model_key" UNIQUE("entity_type","entity_id","model")
);
--> statement-breakpoint
CREATE TABLE "billing"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "billing"."plan_kind" NOT NULL,
	"program_codes" text[] DEFAULT '{""}' NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"credits_included" integer DEFAULT 0 NOT NULL,
	"credits_period" text,
	"duration_days" integer,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "plans_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "billing"."prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"currency" char(3) DEFAULT 'VND' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"compare_at" numeric(14, 2),
	"region" text DEFAULT 'VN' NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"plan_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"promotion_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"status" "billing"."order_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"buyer_info" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "orders_idempotency_key_key" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "billing"."promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"plan_ids" uuid[],
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"per_user_limit" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "promotions_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "billing"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "billing"."payment_provider" NOT NULL,
	"provider_txn_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text NOT NULL,
	"raw_callback" jsonb,
	"signature_valid" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "payments_provider_provider_txn_id_key" UNIQUE("provider","provider_txn_id")
);
--> statement-breakpoint
CREATE TABLE "billing"."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"plan_id" uuid NOT NULL,
	"program_code" text,
	"status" "billing"."subscription_status" NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"provider_token_ref" text,
	"source_order_id" uuid,
	"seats" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_check" CHECK ((user_id IS NOT NULL) OR (org_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "billing"."entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program_code" text,
	"feature_code" text NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "entitlements_user_id_program_code_feature_code_source_sourc_key" UNIQUE("user_id","program_code","feature_code","source","source_id")
);
--> statement-breakpoint
CREATE TABLE "billing"."quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_kind" "billing"."plan_kind" NOT NULL,
	"feature_code" text NOT NULL,
	"period" "billing"."quota_period" NOT NULL,
	"limit_value" integer NOT NULL,
	CONSTRAINT "quotas_plan_kind_feature_code_period_key" UNIQUE("plan_kind","feature_code","period")
);
--> statement-breakpoint
CREATE TABLE "billing"."credit_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" "billing"."credit_reason" NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"ai_task_id" uuid,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_check" CHECK ((user_id IS NOT NULL) OR (org_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "billing"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"series" text,
	"invoice_no" text,
	"lookup_code" text,
	"status" text NOT NULL,
	"pdf_url" text,
	"raw" jsonb,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_order_id_key" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "billing"."reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "billing"."payment_provider" NOT NULL,
	"for_date" date NOT NULL,
	"expected_total" numeric(14, 2),
	"actual_total" numeric(14, 2),
	"mismatches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_runs_provider_for_date_key" UNIQUE("provider","for_date")
);
--> statement-breakpoint
CREATE TABLE "billing"."feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "ops"."notification_channel" NOT NULL,
	"template_code" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "ops"."notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"channels" jsonb DEFAULT '{"push":true,"zalo":false,"email":true,"inapp":true}'::jsonb NOT NULL,
	"quiet_hours" jsonb DEFAULT '{"end":"07:00","start":"22:00"}'::jsonb NOT NULL,
	"reminder_times" text[] DEFAULT '{"20:00"}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"page" text,
	"context" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ops"."support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"subject" text NOT NULL,
	"body" text,
	"channel" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."jobs_deadletter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"job_id" text NOT NULL,
	"payload" jsonb,
	"error" text,
	"attempts" smallint,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"program_code" text,
	"teacher_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iam"."classes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"task_type" "learn"."plan_task_type" NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learn"."assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog"."question_subskills" (
	"question_id" uuid NOT NULL,
	"subskill_id" uuid NOT NULL,
	"weight" numeric(4, 2) DEFAULT '1' NOT NULL,
	CONSTRAINT "question_subskills_pkey" PRIMARY KEY("question_id","subskill_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."vocab_list_items" (
	"list_id" uuid NOT NULL,
	"vocab_item_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "vocab_list_items_pkey" PRIMARY KEY("list_id","vocab_item_id")
);
--> statement-breakpoint
CREATE TABLE "learn"."user_badges" (
	"user_id" uuid NOT NULL,
	"badge_code" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_pkey" PRIMARY KEY("user_id","badge_code")
);
--> statement-breakpoint
CREATE TABLE "catalog"."test_set_sections" (
	"test_set_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"sort_order" smallint NOT NULL,
	"duration_sec" integer,
	CONSTRAINT "test_set_sections_pkey" PRIMARY KEY("test_set_id","section_id")
);
--> statement-breakpoint
CREATE TABLE "ai"."eval_run_items" (
	"run_id" uuid NOT NULL,
	"eval_item_id" uuid NOT NULL,
	"output" jsonb NOT NULL,
	"diff" numeric(6, 3),
	CONSTRAINT "eval_run_items_pkey" PRIMARY KEY("run_id","eval_item_id")
);
--> statement-breakpoint
CREATE TABLE "billing"."credit_balances" (
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_pkey" PRIMARY KEY("owner_type","owner_id"),
	CONSTRAINT "credit_balances_balance_check" CHECK (balance >= 0)
);
--> statement-breakpoint
CREATE TABLE "learn"."assignment_submissions" (
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"result_ref" jsonb,
	"completed_at" timestamp with time zone,
	CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY("assignment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "learn"."assignment_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."shadowing_progress" (
	"user_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"sentences_done" integer DEFAULT 0 NOT NULL,
	"best_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shadowing_progress_pkey" PRIMARY KEY("user_id","video_id")
);
--> statement-breakpoint
CREATE TABLE "billing"."usage_counters" (
	"user_id" uuid NOT NULL,
	"feature_code" text NOT NULL,
	"period_key" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_pkey" PRIMARY KEY("user_id","feature_code","period_key")
);
--> statement-breakpoint
CREATE TABLE "iam"."org_memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "iam"."org_role" NOT NULL,
	"class_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_memberships_pkey" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "iam"."org_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog"."test_set_items" (
	"test_set_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"sort_order" smallint NOT NULL,
	"group_key" text,
	"points" numeric(5, 2) DEFAULT '1' NOT NULL,
	CONSTRAINT "test_set_items_pkey" PRIMARY KEY("test_set_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "learn"."skill_mastery" (
	"user_id" uuid NOT NULL,
	"program_code" text NOT NULL,
	"subskill_id" uuid NOT NULL,
	"mastery" numeric(5, 4) DEFAULT '0' NOT NULL,
	"confidence" numeric(5, 4),
	"n_obs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_mastery_pkey" PRIMARY KEY("user_id","subskill_id")
);
--> statement-breakpoint
CREATE TABLE "learn"."lesson_progress" (
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"current_step" smallint DEFAULT 1 NOT NULL,
	"score" numeric(5, 2),
	"chat_thread_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "lesson_progress_pkey" PRIMARY KEY("user_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "iam"."auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."user_roles" ADD CONSTRAINT "user_roles_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "iam"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."user_roles" ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."referrals" ADD CONSTRAINT "referrals_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."referrals" ADD CONSTRAINT "referrals_referee_user_id_fkey" FOREIGN KEY ("referee_user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."skills" ADD CONSTRAINT "skills_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."sections" ADD CONSTRAINT "sections_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."sections" ADD CONSTRAINT "sections_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "catalog"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."topics" ADD CONSTRAINT "topics_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."subskills" ADD CONSTRAINT "subskills_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."subskills" ADD CONSTRAINT "subskills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "catalog"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."media_assets" ADD CONSTRAINT "media_assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."passages" ADD CONSTRAINT "passages_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."passages" ADD CONSTRAINT "passages_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "catalog"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."passages" ADD CONSTRAINT "passages_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "catalog"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."passages" ADD CONSTRAINT "passages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."questions" ADD CONSTRAINT "questions_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."questions" ADD CONSTRAINT "questions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "catalog"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."questions" ADD CONSTRAINT "questions_question_type_code_fkey" FOREIGN KEY ("question_type_code") REFERENCES "catalog"."question_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."questions" ADD CONSTRAINT "questions_passage_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "catalog"."passages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."questions" ADD CONSTRAINT "questions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "catalog"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."questions" ADD CONSTRAINT "questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."questions" ADD CONSTRAINT "fk_questions_current_version" FOREIGN KEY ("current_version_id") REFERENCES "catalog"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."question_versions" ADD CONSTRAINT "question_versions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "catalog"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."question_versions" ADD CONSTRAINT "question_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."test_sets" ADD CONSTRAINT "test_sets_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."grammar_topics" ADD CONSTRAINT "grammar_topics_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."lessons" ADD CONSTRAINT "lessons_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."lessons" ADD CONSTRAINT "lessons_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "catalog"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."lessons" ADD CONSTRAINT "lessons_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "catalog"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."lessons" ADD CONSTRAINT "lessons_grammar_topic_id_fkey" FOREIGN KEY ("grammar_topic_id") REFERENCES "catalog"."grammar_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."lesson_steps" ADD CONSTRAINT "lesson_steps_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "catalog"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."exercises" ADD CONSTRAINT "exercises_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."exercises" ADD CONSTRAINT "exercises_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "catalog"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."exercises" ADD CONSTRAINT "exercises_grammar_topic_id_fkey" FOREIGN KEY ("grammar_topic_id") REFERENCES "catalog"."grammar_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."videos" ADD CONSTRAINT "videos_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."videos" ADD CONSTRAINT "videos_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."video_sentences" ADD CONSTRAINT "video_sentences_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "catalog"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_items" ADD CONSTRAINT "vocab_items_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_items" ADD CONSTRAINT "vocab_items_audio_uk_id_fkey" FOREIGN KEY ("audio_uk_id") REFERENCES "catalog"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_items" ADD CONSTRAINT "vocab_items_audio_us_id_fkey" FOREIGN KEY ("audio_us_id") REFERENCES "catalog"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_lists" ADD CONSTRAINT "vocab_lists_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_lists" ADD CONSTRAINT "vocab_lists_test_set_id_fkey" FOREIGN KEY ("test_set_id") REFERENCES "catalog"."test_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_lists" ADD CONSTRAINT "vocab_lists_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "catalog"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_lists" ADD CONSTRAINT "vocab_lists_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."content_reviews" ADD CONSTRAINT "content_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."enrollments" ADD CONSTRAINT "enrollments_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."study_plans" ADD CONSTRAINT "study_plans_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "learn"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."plan_weeks" ADD CONSTRAINT "plan_weeks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "learn"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."plan_weeks" ADD CONSTRAINT "plan_weeks_focus_skill_id_fkey" FOREIGN KEY ("focus_skill_id") REFERENCES "catalog"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."plan_weeks" ADD CONSTRAINT "plan_weeks_focus_section_id_fkey" FOREIGN KEY ("focus_section_id") REFERENCES "catalog"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."plan_tasks" ADD CONSTRAINT "plan_tasks_plan_week_id_fkey" FOREIGN KEY ("plan_week_id") REFERENCES "learn"."plan_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."attempts" ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."attempts" ADD CONSTRAINT "attempts_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."attempts" ADD CONSTRAINT "attempts_test_set_id_fkey" FOREIGN KEY ("test_set_id") REFERENCES "catalog"."test_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."attempts" ADD CONSTRAINT "attempts_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "catalog"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."attempts" ADD CONSTRAINT "attempts_plan_task_id_fkey" FOREIGN KEY ("plan_task_id") REFERENCES "learn"."plan_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."recordings" ADD CONSTRAINT "recordings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submissions" ADD CONSTRAINT "submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submissions" ADD CONSTRAINT "submissions_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submissions" ADD CONSTRAINT "submissions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "learn"."attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submissions" ADD CONSTRAINT "submissions_parent_submission_id_fkey" FOREIGN KEY ("parent_submission_id") REFERENCES "learn"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submissions" ADD CONSTRAINT "submissions_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "learn"."recordings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submissions" ADD CONSTRAINT "submissions_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "catalog"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."grading_results" ADD CONSTRAINT "grading_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "learn"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."grading_results" ADD CONSTRAINT "fk_grading_prompt_version" FOREIGN KEY ("prompt_version_id") REFERENCES "ai"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."pronunciation_scores" ADD CONSTRAINT "pronunciation_scores_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "learn"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."phrasing_fixes" ADD CONSTRAINT "phrasing_fixes_grading_result_id_fkey" FOREIGN KEY ("grading_result_id") REFERENCES "learn"."grading_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."error_log_entries" ADD CONSTRAINT "error_log_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."error_log_entries" ADD CONSTRAINT "error_log_entries_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."error_log_entries" ADD CONSTRAINT "error_log_entries_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "learn"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."error_log_entries" ADD CONSTRAINT "error_log_entries_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "catalog"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."error_log_entries" ADD CONSTRAINT "error_log_entries_subskill_id_fkey" FOREIGN KEY ("subskill_id") REFERENCES "catalog"."subskills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."srs_cards" ADD CONSTRAINT "srs_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."srs_cards" ADD CONSTRAINT "srs_cards_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."srs_reviews" ADD CONSTRAINT "srs_reviews_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "learn"."srs_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."notes" ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."notes" ADD CONSTRAINT "notes_test_set_id_fkey" FOREIGN KEY ("test_set_id") REFERENCES "catalog"."test_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."notes" ADD CONSTRAINT "notes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "catalog"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."streaks" ADD CONSTRAINT "streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."xp_events" ADD CONSTRAINT "xp_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."score_forecasts" ADD CONSTRAINT "score_forecasts_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "learn"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."chat_threads" ADD CONSTRAINT "chat_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."chat_threads" ADD CONSTRAINT "chat_threads_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "learn"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."prompt_templates" ADD CONSTRAINT "prompt_templates_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."prompt_versions" ADD CONSTRAINT "prompt_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "ai"."prompt_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."explanation_cache" ADD CONSTRAINT "explanation_cache_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "catalog"."question_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."explanation_cache" ADD CONSTRAINT "explanation_cache_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."eval_sets" ADD CONSTRAINT "eval_sets_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."eval_items" ADD CONSTRAINT "eval_items_eval_set_id_fkey" FOREIGN KEY ("eval_set_id") REFERENCES "ai"."eval_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."eval_runs" ADD CONSTRAINT "eval_runs_eval_set_id_fkey" FOREIGN KEY ("eval_set_id") REFERENCES "ai"."eval_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."eval_runs" ADD CONSTRAINT "eval_runs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."prices" ADD CONSTRAINT "prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."orders" ADD CONSTRAINT "orders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "iam"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."orders" ADD CONSTRAINT "orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."orders" ADD CONSTRAINT "orders_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "billing"."prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."orders" ADD CONSTRAINT "orders_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "billing"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "iam"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_source_order_id_fkey" FOREIGN KEY ("source_order_id") REFERENCES "billing"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."entitlements" ADD CONSTRAINT "entitlements_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "iam"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."content_reports" ADD CONSTRAINT "content_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."content_reports" ADD CONSTRAINT "content_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."classes" ADD CONSTRAINT "classes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "iam"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."classes" ADD CONSTRAINT "classes_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignments" ADD CONSTRAINT "assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "iam"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignments" ADD CONSTRAINT "assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "iam"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignments" ADD CONSTRAINT "assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."question_subskills" ADD CONSTRAINT "question_subskills_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "catalog"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."question_subskills" ADD CONSTRAINT "question_subskills_subskill_id_fkey" FOREIGN KEY ("subskill_id") REFERENCES "catalog"."subskills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_list_items" ADD CONSTRAINT "vocab_list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "catalog"."vocab_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."vocab_list_items" ADD CONSTRAINT "vocab_list_items_vocab_item_id_fkey" FOREIGN KEY ("vocab_item_id") REFERENCES "catalog"."vocab_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."user_badges" ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."user_badges" ADD CONSTRAINT "user_badges_badge_code_fkey" FOREIGN KEY ("badge_code") REFERENCES "learn"."badges"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."test_set_sections" ADD CONSTRAINT "test_set_sections_test_set_id_fkey" FOREIGN KEY ("test_set_id") REFERENCES "catalog"."test_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."test_set_sections" ADD CONSTRAINT "test_set_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "catalog"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."eval_run_items" ADD CONSTRAINT "eval_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."eval_run_items" ADD CONSTRAINT "eval_run_items_eval_item_id_fkey" FOREIGN KEY ("eval_item_id") REFERENCES "ai"."eval_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignment_submissions" ADD CONSTRAINT "assignment_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."shadowing_progress" ADD CONSTRAINT "shadowing_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."shadowing_progress" ADD CONSTRAINT "shadowing_progress_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "catalog"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."usage_counters" ADD CONSTRAINT "usage_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."org_memberships" ADD CONSTRAINT "org_memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "iam"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."org_memberships" ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."org_memberships" ADD CONSTRAINT "org_memberships_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "iam"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."test_set_items" ADD CONSTRAINT "test_set_items_test_set_id_fkey" FOREIGN KEY ("test_set_id") REFERENCES "catalog"."test_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."test_set_items" ADD CONSTRAINT "test_set_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "catalog"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."test_set_items" ADD CONSTRAINT "test_set_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "catalog"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."skill_mastery" ADD CONSTRAINT "skill_mastery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."skill_mastery" ADD CONSTRAINT "skill_mastery_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "catalog"."programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."skill_mastery" ADD CONSTRAINT "skill_mastery_subskill_id_fkey" FOREIGN KEY ("subskill_id") REFERENCES "catalog"."subskills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "catalog"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_auth_identities_user" ON "iam"."auth_identities" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_sessions_user_active" ON "iam"."sessions" USING btree ("user_id" uuid_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "ix_referrals_referrer" ON "iam"."referrals" USING btree ("referrer_user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_consents_user_type" ON "iam"."consents" USING btree ("user_id" uuid_ops,"type" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_passages_program_status" ON "catalog"."passages" USING btree ("program_code" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "ix_questions_irt" ON "catalog"."questions" USING btree ("program_code" uuid_ops,"section_id" numeric_ops,"irt_b" text_ops) WHERE (status = 'published'::catalog.content_status);--> statement-breakpoint
CREATE INDEX "ix_questions_passage" ON "catalog"."questions" USING btree ("passage_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_questions_program_section_status" ON "catalog"."questions" USING btree ("program_code" enum_ops,"section_id" uuid_ops,"status" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_test_sets_program_kind" ON "catalog"."test_sets" USING btree ("program_code" enum_ops,"kind" text_ops,"status" enum_ops);--> statement-breakpoint
CREATE INDEX "ix_lessons_program_kind" ON "catalog"."lessons" USING btree ("program_code" enum_ops,"kind" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "ix_exercises_grammar" ON "catalog"."exercises" USING btree ("grammar_topic_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_exercises_lesson" ON "catalog"."exercises" USING btree ("lesson_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_videos_program_category" ON "catalog"."videos" USING btree ("program_code" enum_ops,"category" text_ops,"status" enum_ops);--> statement-breakpoint
CREATE INDEX "ix_vocab_items_headword_trgm" ON "catalog"."vocab_items" USING gin ("headword" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_vocab_items_program_headword" ON "catalog"."vocab_items" USING btree ("program_code" text_ops,"headword" text_ops);--> statement-breakpoint
CREATE INDEX "ix_vocab_lists_owner" ON "catalog"."vocab_lists" USING btree ("owner_user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_content_reviews_entity" ON "catalog"."content_reviews" USING btree ("entity_type" timestamptz_ops,"entity_id" timestamptz_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "ix_study_plans_current" ON "learn"."study_plans" USING btree ("enrollment_id" uuid_ops) WHERE is_current;--> statement-breakpoint
CREATE INDEX "ix_plan_tasks_week_due" ON "learn"."plan_tasks" USING btree ("plan_week_id" date_ops,"due_date" date_ops);--> statement-breakpoint
CREATE INDEX "ix_attempts_in_progress" ON "learn"."attempts" USING btree ("user_id" uuid_ops) WHERE (status = 'in_progress'::learn.attempt_status);--> statement-breakpoint
CREATE INDEX "ix_attempts_test_set" ON "learn"."attempts" USING btree ("test_set_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_attempts_user_started" ON "learn"."attempts" USING btree ("user_id" uuid_ops,"started_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_recordings_expiry" ON "learn"."recordings" USING btree ("expires_at" timestamptz_ops) WHERE (expires_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "ix_submissions_status" ON "learn"."submissions" USING btree ("status" enum_ops) WHERE (status = ANY (ARRAY['queued'::learn.submission_status, 'processing'::learn.submission_status]));--> statement-breakpoint
CREATE INDEX "ix_submissions_user_created" ON "learn"."submissions" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_error_log_user_recent" ON "learn"."error_log_entries" USING btree ("user_id" timestamptz_ops,"program_code" timestamptz_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "ix_srs_cards_due" ON "learn"."srs_cards" USING btree ("user_id" text_ops,"program_code" uuid_ops,"due_at" uuid_ops) WHERE (NOT suspended);--> statement-breakpoint
CREATE INDEX "ix_srs_reviews_card" ON "learn"."srs_reviews" USING btree ("card_id" timestamptz_ops,"reviewed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_notes_user_test" ON "learn"."notes" USING btree ("user_id" uuid_ops,"test_set_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_xp_events_user_date" ON "learn"."xp_events" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_score_forecasts_enrollment" ON "learn"."score_forecasts" USING btree ("enrollment_id" timestamptz_ops,"computed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_chat_threads_user" ON "learn"."chat_threads" USING btree ("user_id" timestamptz_ops,"updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_chat_messages_thread" ON "learn"."chat_messages" USING btree ("thread_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_prompt_versions_active" ON "ai"."prompt_versions" USING btree ("template_id" uuid_ops) WHERE (status = ANY (ARRAY['active'::ai.prompt_status, 'canary'::ai.prompt_status]));--> statement-breakpoint
CREATE INDEX "ix_embeddings_hnsw" ON "ai"."embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "ix_prices_plan_valid" ON "billing"."prices" USING btree ("plan_id" uuid_ops,"valid_from" timestamptz_ops,"valid_to" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_orders_user_created" ON "billing"."orders" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_payments_order" ON "billing"."payments" USING btree ("order_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_subscriptions_period_end" ON "billing"."subscriptions" USING btree ("current_period_end" timestamptz_ops) WHERE (status = 'active'::billing.subscription_status);--> statement-breakpoint
CREATE INDEX "ix_subscriptions_user_status" ON "billing"."subscriptions" USING btree ("user_id" uuid_ops,"status" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_entitlements_user_valid" ON "billing"."entitlements" USING btree ("user_id" timestamptz_ops,"feature_code" timestamptz_ops,"valid_to" text_ops);--> statement-breakpoint
CREATE INDEX "ix_credit_ledger_org_created" ON "billing"."credit_ledger" USING btree ("org_id" timestamptz_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_credit_ledger_user_created" ON "billing"."credit_ledger" USING btree ("user_id" uuid_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_notifications_due" ON "ops"."notifications" USING btree ("scheduled_at" timestamptz_ops) WHERE (status = 'scheduled'::text);--> statement-breakpoint
CREATE INDEX "ix_notifications_user_status" ON "ops"."notifications" USING btree ("user_id" timestamptz_ops,"status" timestamptz_ops,"scheduled_at" text_ops);--> statement-breakpoint
CREATE INDEX "ix_content_reports_entity" ON "ops"."content_reports" USING btree ("entity_type" text_ops,"entity_id" uuid_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "ix_org_memberships_user" ON "iam"."org_memberships" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ix_test_set_items_order" ON "catalog"."test_set_items" USING btree ("test_set_id" uuid_ops,"section_id" uuid_ops,"sort_order" uuid_ops);--> statement-breakpoint
CREATE VIEW "learn"."v_user_program_summary" AS (SELECT e.user_id, e.program_code, e.target_score, e.exam_date, ( SELECT a.scaled_score FROM learn.attempts a WHERE a.user_id = e.user_id AND a.program_code = e.program_code AND a.status = 'graded'::learn.attempt_status AND (a.mode = ANY (ARRAY['exam'::learn.attempt_mode, 'diagnostic'::learn.attempt_mode])) ORDER BY a.submitted_at DESC LIMIT 1) AS last_scaled_score, ( SELECT count(*) AS count FROM learn.srs_cards c WHERE c.user_id = e.user_id AND c.program_code = e.program_code AND c.due_at <= now() AND NOT c.suspended) AS cards_due, s.current_streak FROM learn.enrollments e LEFT JOIN learn.streaks s ON s.user_id = e.user_id WHERE e.is_active);--> statement-breakpoint
CREATE VIEW "billing"."v_active_entitlements" AS (SELECT user_id, program_code, feature_code, min(valid_from) AS valid_from, max(valid_to) AS valid_to FROM billing.entitlements WHERE valid_from <= now() AND (valid_to IS NULL OR valid_to > now()) GROUP BY user_id, program_code, feature_code);--> statement-breakpoint
CREATE POLICY "org_scope_classes" ON "iam"."classes" AS PERMISSIVE FOR ALL TO public USING (((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true))));--> statement-breakpoint
CREATE POLICY "org_scope_assignments" ON "learn"."assignments" AS PERMISSIVE FOR ALL TO public USING (((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true))));--> statement-breakpoint
CREATE POLICY "org_scope_assignment_submissions" ON "learn"."assignment_submissions" AS PERMISSIVE FOR ALL TO public USING (((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((user_id)::text = current_setting('app.user_id'::text, true)) OR (EXISTS ( SELECT 1
   FROM learn.assignments a
  WHERE ((a.id = assignment_submissions.assignment_id) AND ((a.org_id)::text = current_setting('app.org_id'::text, true)))))));--> statement-breakpoint
CREATE POLICY "org_scope_memberships" ON "iam"."org_memberships" AS PERMISSIVE FOR ALL TO public USING (((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true)) OR ((user_id)::text = current_setting('app.user_id'::text, true))));
*/