import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "cms"."enum_users_role" AS ENUM('editor', 'teacher', 'admin');
  CREATE TYPE "cms"."enum_media_kind" AS ENUM('audio', 'image');
  CREATE TYPE "cms"."enum_passages_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk');
  CREATE TYPE "cms"."enum_passages_kind" AS ENUM('reading_passage', 'audio_script', 'image_prompt', 'chart_prompt', 'dialogue');
  CREATE TYPE "cms"."enum_passages_difficulty" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'N5', 'N4', 'N3', 'N2', 'N1', 'HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7_9', 'mixed');
  CREATE TYPE "cms"."enum_passages_status" AS ENUM('draft', 'ready', 'retired');
  CREATE TYPE "cms"."enum_questions_reviews_stage" AS ENUM('ai_check', 'review1', 'review2');
  CREATE TYPE "cms"."enum_questions_reviews_decision" AS ENUM('approve', 'reject', 'needs_change', 'submit', 'retire', 'reopen');
  CREATE TYPE "cms"."enum_questions_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk');
  CREATE TYPE "cms"."enum_questions_question_type" AS ENUM('mcq_single', 'mcq_multi', 'fill_blank', 'matching', 'drag_drop', 'map_label', 'tfng', 'ordering', 'dictation', 'essay', 'speaking', 'handwriting');
  CREATE TYPE "cms"."enum_questions_difficulty" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'N5', 'N4', 'N3', 'N2', 'N1', 'HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7_9', 'mixed');
  CREATE TYPE "cms"."enum_questions_source" AS ENUM('human', 'ai', 'licensed');
  CREATE TYPE "cms"."enum_questions_media_listen_policy" AS ENUM('once', 'free');
  CREATE TYPE "cms"."enum_questions_status" AS ENUM('draft', 'ai_checked', 'review1', 'review2', 'published', 'rejected', 'retired');
  CREATE TYPE "cms"."enum_test_sets_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk');
  CREATE TYPE "cms"."enum_test_sets_kind" AS ENUM('full', 'mini', 'part_drill', 'diagnostic', 'topic_pack');
  CREATE TYPE "cms"."enum_test_sets_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum_lessons_steps_type" AS ENUM('text', 'practice');
  CREATE TYPE "cms"."enum_lessons_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk');
  CREATE TYPE "cms"."enum_lessons_kind" AS ENUM('lesson', 'grammar', 'pronunciation', 'strategy');
  CREATE TYPE "cms"."enum_lessons_status" AS ENUM('draft', 'published', 'retired');
  CREATE TYPE "cms"."enum_vocab_items_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk');
  CREATE TYPE "cms"."enum_vocab_items_kind" AS ENUM('word', 'collocation', 'phrasal_verb', 'kanji', 'hanzi', 'grammar_point');
  CREATE TYPE "cms"."enum_vocab_items_level" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'N5', 'N4', 'N3', 'N2', 'N1', 'HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7_9', 'mixed');
  CREATE TYPE "cms"."enum_vocab_items_status" AS ENUM('draft', 'published', 'retired');
  CREATE TYPE "cms"."enum_prompt_templates_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk');
  CREATE TYPE "cms"."enum_prompt_versions_status" AS ENUM('draft', 'canary', 'active', 'retired');
  CREATE TABLE "cms"."users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "cms"."users" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar NOT NULL,
  	"role" "cms"."enum_users_role" DEFAULT 'editor' NOT NULL,
  	"api_user_email" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "cms"."media" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"kind" "cms"."enum_media_kind" DEFAULT 'audio' NOT NULL,
  	"duration_ms" numeric,
  	"license" varchar DEFAULT 'own' NOT NULL,
  	"transcript" varchar,
  	"alt" varchar,
  	"synced_asset_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_thumbnail_url" varchar,
  	"sizes_thumbnail_width" numeric,
  	"sizes_thumbnail_height" numeric,
  	"sizes_thumbnail_mime_type" varchar,
  	"sizes_thumbnail_filesize" numeric,
  	"sizes_thumbnail_filename" varchar
  );
  
  CREATE TABLE "cms"."passages" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar NOT NULL,
  	"program" "cms"."enum_passages_program" NOT NULL,
  	"kind" "cms"."enum_passages_kind" DEFAULT 'reading_passage' NOT NULL,
  	"difficulty" "cms"."enum_passages_difficulty",
  	"body" varchar,
  	"word_count" numeric,
  	"status" "cms"."enum_passages_status" DEFAULT 'draft' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."passages_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" uuid
  );
  
  CREATE TABLE "cms"."questions_subskill_codes" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL
  );
  
  CREATE TABLE "cms"."questions_reviews" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"stage" "cms"."enum_questions_reviews_stage" NOT NULL,
  	"decision" "cms"."enum_questions_reviews_decision" NOT NULL,
  	"reviewer" varchar,
  	"at" timestamp(3) with time zone NOT NULL,
  	"note" varchar
  );
  
  CREATE TABLE "cms"."questions" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"program" "cms"."enum_questions_program" DEFAULT 'toeic' NOT NULL,
  	"section_code" varchar NOT NULL,
  	"question_type" "cms"."enum_questions_question_type" DEFAULT 'mcq_single' NOT NULL,
  	"difficulty" "cms"."enum_questions_difficulty",
  	"topic_code" varchar,
  	"source" "cms"."enum_questions_source" DEFAULT 'human' NOT NULL,
  	"passage_id" uuid,
  	"media_listen_policy" "cms"."enum_questions_media_listen_policy",
  	"media_pause_ms" numeric,
  	"content" jsonb NOT NULL,
  	"status" "cms"."enum_questions_status" DEFAULT 'draft' NOT NULL,
  	"review_note" varchar,
  	"external_ref" varchar,
  	"published_ref_question_id" varchar,
  	"published_ref_question_version_id" varchar,
  	"published_ref_version_no" numeric,
  	"published_ref_published_at" timestamp(3) with time zone,
  	"ai_report" jsonb,
  	"import_key" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."test_sets_sections" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"section_code" varchar NOT NULL,
  	"duration_sec" numeric
  );
  
  CREATE TABLE "cms"."test_sets_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question_id" uuid NOT NULL,
  	"section_code" varchar NOT NULL,
  	"sort_order" numeric NOT NULL,
  	"group_key" varchar,
  	"points" numeric DEFAULT 1
  );
  
  CREATE TABLE "cms"."test_sets" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"program" "cms"."enum_test_sets_program" DEFAULT 'toeic' NOT NULL,
  	"code" varchar NOT NULL,
  	"kind" "cms"."enum_test_sets_kind" DEFAULT 'mini' NOT NULL,
  	"title_vi" varchar NOT NULL,
  	"title_en" varchar,
  	"is_free" boolean DEFAULT false,
  	"duration_sec" numeric,
  	"status" "cms"."enum_test_sets_status" DEFAULT 'draft' NOT NULL,
  	"external_ref" varchar,
  	"published_ref_test_set_id" varchar,
  	"published_ref_published_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."lessons_steps" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"type" "cms"."enum_lessons_steps_type" DEFAULT 'text' NOT NULL,
  	"content" jsonb NOT NULL
  );
  
  CREATE TABLE "cms"."lessons" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"code" varchar NOT NULL,
  	"program" "cms"."enum_lessons_program" DEFAULT 'toeic' NOT NULL,
  	"kind" "cms"."enum_lessons_kind" DEFAULT 'lesson' NOT NULL,
  	"title_vi" varchar NOT NULL,
  	"title_en" varchar,
  	"summary_vi" varchar,
  	"summary_en" varchar,
  	"est_minutes" numeric DEFAULT 10,
  	"is_free" boolean DEFAULT false,
  	"status" "cms"."enum_lessons_status" DEFAULT 'draft' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."vocab_items" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"program" "cms"."enum_vocab_items_program" DEFAULT 'toeic' NOT NULL,
  	"kind" "cms"."enum_vocab_items_kind" DEFAULT 'word' NOT NULL,
  	"level" "cms"."enum_vocab_items_level",
  	"headword" varchar NOT NULL,
  	"pos" varchar,
  	"ipa" varchar,
  	"meanings" jsonb DEFAULT '{"vi":"","en":""}'::jsonb NOT NULL,
  	"examples" jsonb DEFAULT '[]'::jsonb,
  	"topic_code" varchar,
  	"audio_id" uuid,
  	"status" "cms"."enum_vocab_items_status" DEFAULT 'draft' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."prompt_templates" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"code" varchar NOT NULL,
  	"program" "cms"."enum_prompt_templates_program",
  	"description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."prompt_versions" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"template_id" uuid NOT NULL,
  	"label" varchar NOT NULL,
  	"status" "cms"."enum_prompt_versions_status" DEFAULT 'draft' NOT NULL,
  	"system_prompt" varchar NOT NULL,
  	"user_template" varchar NOT NULL,
  	"output_schema" jsonb,
  	"model_policy" jsonb,
  	"change_note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."payload_kv" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "cms"."payload_locked_documents" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" uuid,
  	"media_id" uuid,
  	"passages_id" uuid,
  	"questions_id" uuid,
  	"test_sets_id" uuid,
  	"lessons_id" uuid,
  	"vocab_items_id" uuid,
  	"prompt_templates_id" uuid,
  	"prompt_versions_id" uuid
  );
  
  CREATE TABLE "cms"."payload_preferences" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" uuid
  );
  
  CREATE TABLE "cms"."payload_migrations" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "cms"."users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."passages_rels" ADD CONSTRAINT "passages_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."passages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."passages_rels" ADD CONSTRAINT "passages_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "cms"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."questions_subskill_codes" ADD CONSTRAINT "questions_subskill_codes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."questions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."questions_reviews" ADD CONSTRAINT "questions_reviews_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."questions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."questions" ADD CONSTRAINT "questions_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "cms"."passages"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."test_sets_sections" ADD CONSTRAINT "test_sets_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."test_sets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."test_sets_items" ADD CONSTRAINT "test_sets_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "cms"."questions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."test_sets_items" ADD CONSTRAINT "test_sets_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."test_sets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."lessons_steps" ADD CONSTRAINT "lessons_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."lessons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."vocab_items" ADD CONSTRAINT "vocab_items_audio_id_media_id_fk" FOREIGN KEY ("audio_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."prompt_versions" ADD CONSTRAINT "prompt_versions_template_id_prompt_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "cms"."prompt_templates"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "cms"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "cms"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_passages_fk" FOREIGN KEY ("passages_id") REFERENCES "cms"."passages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_questions_fk" FOREIGN KEY ("questions_id") REFERENCES "cms"."questions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_test_sets_fk" FOREIGN KEY ("test_sets_id") REFERENCES "cms"."test_sets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_lessons_fk" FOREIGN KEY ("lessons_id") REFERENCES "cms"."lessons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_vocab_items_fk" FOREIGN KEY ("vocab_items_id") REFERENCES "cms"."vocab_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_prompt_templates_fk" FOREIGN KEY ("prompt_templates_id") REFERENCES "cms"."prompt_templates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_prompt_versions_fk" FOREIGN KEY ("prompt_versions_id") REFERENCES "cms"."prompt_versions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "cms"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_sessions_order_idx" ON "cms"."users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "cms"."users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "cms"."users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "cms"."users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "cms"."users" USING btree ("email");
  CREATE INDEX "media_updated_at_idx" ON "cms"."media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "cms"."media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "cms"."media" USING btree ("filename");
  CREATE INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "cms"."media" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "passages_updated_at_idx" ON "cms"."passages" USING btree ("updated_at");
  CREATE INDEX "passages_created_at_idx" ON "cms"."passages" USING btree ("created_at");
  CREATE INDEX "passages_rels_order_idx" ON "cms"."passages_rels" USING btree ("order");
  CREATE INDEX "passages_rels_parent_idx" ON "cms"."passages_rels" USING btree ("parent_id");
  CREATE INDEX "passages_rels_path_idx" ON "cms"."passages_rels" USING btree ("path");
  CREATE INDEX "passages_rels_media_id_idx" ON "cms"."passages_rels" USING btree ("media_id");
  CREATE INDEX "questions_subskill_codes_order_idx" ON "cms"."questions_subskill_codes" USING btree ("_order");
  CREATE INDEX "questions_subskill_codes_parent_id_idx" ON "cms"."questions_subskill_codes" USING btree ("_parent_id");
  CREATE INDEX "questions_reviews_order_idx" ON "cms"."questions_reviews" USING btree ("_order");
  CREATE INDEX "questions_reviews_parent_id_idx" ON "cms"."questions_reviews" USING btree ("_parent_id");
  CREATE INDEX "questions_passage_idx" ON "cms"."questions" USING btree ("passage_id");
  CREATE INDEX "questions_external_ref_idx" ON "cms"."questions" USING btree ("external_ref");
  CREATE INDEX "questions_import_key_idx" ON "cms"."questions" USING btree ("import_key");
  CREATE INDEX "questions_updated_at_idx" ON "cms"."questions" USING btree ("updated_at");
  CREATE INDEX "questions_created_at_idx" ON "cms"."questions" USING btree ("created_at");
  CREATE INDEX "test_sets_sections_order_idx" ON "cms"."test_sets_sections" USING btree ("_order");
  CREATE INDEX "test_sets_sections_parent_id_idx" ON "cms"."test_sets_sections" USING btree ("_parent_id");
  CREATE INDEX "test_sets_items_order_idx" ON "cms"."test_sets_items" USING btree ("_order");
  CREATE INDEX "test_sets_items_parent_id_idx" ON "cms"."test_sets_items" USING btree ("_parent_id");
  CREATE INDEX "test_sets_items_question_idx" ON "cms"."test_sets_items" USING btree ("question_id");
  CREATE UNIQUE INDEX "test_sets_code_idx" ON "cms"."test_sets" USING btree ("code");
  CREATE INDEX "test_sets_external_ref_idx" ON "cms"."test_sets" USING btree ("external_ref");
  CREATE INDEX "test_sets_updated_at_idx" ON "cms"."test_sets" USING btree ("updated_at");
  CREATE INDEX "test_sets_created_at_idx" ON "cms"."test_sets" USING btree ("created_at");
  CREATE INDEX "lessons_steps_order_idx" ON "cms"."lessons_steps" USING btree ("_order");
  CREATE INDEX "lessons_steps_parent_id_idx" ON "cms"."lessons_steps" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "lessons_code_idx" ON "cms"."lessons" USING btree ("code");
  CREATE INDEX "lessons_updated_at_idx" ON "cms"."lessons" USING btree ("updated_at");
  CREATE INDEX "lessons_created_at_idx" ON "cms"."lessons" USING btree ("created_at");
  CREATE INDEX "vocab_items_audio_idx" ON "cms"."vocab_items" USING btree ("audio_id");
  CREATE INDEX "vocab_items_updated_at_idx" ON "cms"."vocab_items" USING btree ("updated_at");
  CREATE INDEX "vocab_items_created_at_idx" ON "cms"."vocab_items" USING btree ("created_at");
  CREATE UNIQUE INDEX "prompt_templates_code_idx" ON "cms"."prompt_templates" USING btree ("code");
  CREATE INDEX "prompt_templates_updated_at_idx" ON "cms"."prompt_templates" USING btree ("updated_at");
  CREATE INDEX "prompt_templates_created_at_idx" ON "cms"."prompt_templates" USING btree ("created_at");
  CREATE INDEX "prompt_versions_template_idx" ON "cms"."prompt_versions" USING btree ("template_id");
  CREATE INDEX "prompt_versions_updated_at_idx" ON "cms"."prompt_versions" USING btree ("updated_at");
  CREATE INDEX "prompt_versions_created_at_idx" ON "cms"."prompt_versions" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "cms"."payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "cms"."payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "cms"."payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "cms"."payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "cms"."payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "cms"."payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "cms"."payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_passages_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("passages_id");
  CREATE INDEX "payload_locked_documents_rels_questions_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("questions_id");
  CREATE INDEX "payload_locked_documents_rels_test_sets_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("test_sets_id");
  CREATE INDEX "payload_locked_documents_rels_lessons_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("lessons_id");
  CREATE INDEX "payload_locked_documents_rels_vocab_items_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("vocab_items_id");
  CREATE INDEX "payload_locked_documents_rels_prompt_templates_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("prompt_templates_id");
  CREATE INDEX "payload_locked_documents_rels_prompt_versions_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("prompt_versions_id");
  CREATE INDEX "payload_preferences_key_idx" ON "cms"."payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "cms"."payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "cms"."payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "cms"."payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "cms"."payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "cms"."payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "cms"."payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "cms"."payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "cms"."payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "cms"."users_sessions" CASCADE;
  DROP TABLE "cms"."users" CASCADE;
  DROP TABLE "cms"."media" CASCADE;
  DROP TABLE "cms"."passages" CASCADE;
  DROP TABLE "cms"."passages_rels" CASCADE;
  DROP TABLE "cms"."questions_subskill_codes" CASCADE;
  DROP TABLE "cms"."questions_reviews" CASCADE;
  DROP TABLE "cms"."questions" CASCADE;
  DROP TABLE "cms"."test_sets_sections" CASCADE;
  DROP TABLE "cms"."test_sets_items" CASCADE;
  DROP TABLE "cms"."test_sets" CASCADE;
  DROP TABLE "cms"."lessons_steps" CASCADE;
  DROP TABLE "cms"."lessons" CASCADE;
  DROP TABLE "cms"."vocab_items" CASCADE;
  DROP TABLE "cms"."prompt_templates" CASCADE;
  DROP TABLE "cms"."prompt_versions" CASCADE;
  DROP TABLE "cms"."payload_kv" CASCADE;
  DROP TABLE "cms"."payload_locked_documents" CASCADE;
  DROP TABLE "cms"."payload_locked_documents_rels" CASCADE;
  DROP TABLE "cms"."payload_preferences" CASCADE;
  DROP TABLE "cms"."payload_preferences_rels" CASCADE;
  DROP TABLE "cms"."payload_migrations" CASCADE;
  DROP TYPE "cms"."enum_users_role";
  DROP TYPE "cms"."enum_media_kind";
  DROP TYPE "cms"."enum_passages_program";
  DROP TYPE "cms"."enum_passages_kind";
  DROP TYPE "cms"."enum_passages_difficulty";
  DROP TYPE "cms"."enum_passages_status";
  DROP TYPE "cms"."enum_questions_reviews_stage";
  DROP TYPE "cms"."enum_questions_reviews_decision";
  DROP TYPE "cms"."enum_questions_program";
  DROP TYPE "cms"."enum_questions_question_type";
  DROP TYPE "cms"."enum_questions_difficulty";
  DROP TYPE "cms"."enum_questions_source";
  DROP TYPE "cms"."enum_questions_media_listen_policy";
  DROP TYPE "cms"."enum_questions_status";
  DROP TYPE "cms"."enum_test_sets_program";
  DROP TYPE "cms"."enum_test_sets_kind";
  DROP TYPE "cms"."enum_test_sets_status";
  DROP TYPE "cms"."enum_lessons_steps_type";
  DROP TYPE "cms"."enum_lessons_program";
  DROP TYPE "cms"."enum_lessons_kind";
  DROP TYPE "cms"."enum_lessons_status";
  DROP TYPE "cms"."enum_vocab_items_program";
  DROP TYPE "cms"."enum_vocab_items_kind";
  DROP TYPE "cms"."enum_vocab_items_level";
  DROP TYPE "cms"."enum_vocab_items_status";
  DROP TYPE "cms"."enum_prompt_templates_program";
  DROP TYPE "cms"."enum_prompt_versions_status";`)
}
