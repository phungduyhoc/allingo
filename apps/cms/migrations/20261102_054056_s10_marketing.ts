import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "cms"."enum_posts_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk', 'general');
  CREATE TYPE "cms"."enum_posts_schema_type" AS ENUM('BlogPosting', 'Article');
  CREATE TYPE "cms"."enum_posts_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__posts_v_version_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk', 'general');
  CREATE TYPE "cms"."enum__posts_v_version_schema_type" AS ENUM('BlogPosting', 'Article');
  CREATE TYPE "cms"."enum__posts_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum_pages_blocks_pricing_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk');
  CREATE TYPE "cms"."enum_pages_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__pages_v_blocks_pricing_program" AS ENUM('toeic', 'ielts', 'jlpt', 'hsk');
  CREATE TYPE "cms"."enum__pages_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum_redirects_type" AS ENUM('301', '302');
  CREATE TABLE "cms"."marketing_media" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"alt_vi" varchar NOT NULL,
  	"alt_en" varchar,
  	"license" varchar DEFAULT 'own' NOT NULL,
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
  	"sizes_card_url" varchar,
  	"sizes_card_width" numeric,
  	"sizes_card_height" numeric,
  	"sizes_card_mime_type" varchar,
  	"sizes_card_filesize" numeric,
  	"sizes_card_filename" varchar,
  	"sizes_og_url" varchar,
  	"sizes_og_width" numeric,
  	"sizes_og_height" numeric,
  	"sizes_og_mime_type" varchar,
  	"sizes_og_filesize" numeric,
  	"sizes_og_filename" varchar
  );
  
  CREATE TABLE "cms"."categories" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"slug" varchar NOT NULL,
  	"name_vi" varchar NOT NULL,
  	"name_en" varchar,
  	"description_vi" varchar,
  	"description_en" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."authors" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"bio_vi" varchar,
  	"bio_en" varchar,
  	"avatar_id" uuid,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."posts_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question_vi" varchar,
  	"question_en" varchar,
  	"answer_vi" varchar,
  	"answer_en" varchar
  );
  
  CREATE TABLE "cms"."posts" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title_vi" varchar,
  	"title_en" varchar,
  	"slug" varchar,
  	"excerpt_vi" varchar,
  	"excerpt_en" varchar,
  	"content_vi" jsonb,
  	"content_en" jsonb,
  	"cover_image_id" uuid,
  	"category_id" uuid,
  	"program" "cms"."enum_posts_program" DEFAULT 'toeic',
  	"published_at" timestamp(3) with time zone,
  	"reading_minutes" numeric,
  	"schema_type" "cms"."enum_posts_schema_type" DEFAULT 'BlogPosting',
  	"seo_title_vi" varchar,
  	"seo_title_en" varchar,
  	"seo_description_vi" varchar,
  	"seo_description_en" varchar,
  	"seo_og_image_id" uuid,
  	"seo_canonical" varchar,
  	"seo_noindex" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "cms"."enum_posts_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "cms"."posts_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"authors_id" uuid
  );
  
  CREATE TABLE "cms"."_posts_v_version_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"question_vi" varchar,
  	"question_en" varchar,
  	"answer_vi" varchar,
  	"answer_en" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "cms"."_posts_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_title_vi" varchar,
  	"version_title_en" varchar,
  	"version_slug" varchar,
  	"version_excerpt_vi" varchar,
  	"version_excerpt_en" varchar,
  	"version_content_vi" jsonb,
  	"version_content_en" jsonb,
  	"version_cover_image_id" uuid,
  	"version_category_id" uuid,
  	"version_program" "cms"."enum__posts_v_version_program" DEFAULT 'toeic',
  	"version_published_at" timestamp(3) with time zone,
  	"version_reading_minutes" numeric,
  	"version_schema_type" "cms"."enum__posts_v_version_schema_type" DEFAULT 'BlogPosting',
  	"version_seo_title_vi" varchar,
  	"version_seo_title_en" varchar,
  	"version_seo_description_vi" varchar,
  	"version_seo_description_en" varchar,
  	"version_seo_og_image_id" uuid,
  	"version_seo_canonical" varchar,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "cms"."enum__posts_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "cms"."_posts_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"authors_id" uuid
  );
  
  CREATE TABLE "cms"."pages_blocks_hero" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow_vi" varchar,
  	"eyebrow_en" varchar,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"subheading_vi" varchar,
  	"subheading_en" varchar,
  	"primary_cta_label_vi" varchar,
  	"primary_cta_label_en" varchar,
  	"primary_cta_href" varchar,
  	"secondary_cta_label_vi" varchar,
  	"secondary_cta_label_en" varchar,
  	"secondary_cta_href" varchar,
  	"image_id" uuid,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_features_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"icon" varchar,
  	"title_vi" varchar,
  	"title_en" varchar,
  	"body_vi" varchar,
  	"body_en" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_features" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_pricing" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"note_vi" varchar,
  	"note_en" varchar,
  	"program" "cms"."enum_pages_blocks_pricing_program" DEFAULT 'toeic',
  	"highlight_plan_code" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_faq_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question_vi" varchar,
  	"question_en" varchar,
  	"answer_vi" varchar,
  	"answer_en" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_testimonial_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"quote_vi" varchar,
  	"quote_en" varchar,
  	"name" varchar,
  	"role_vi" varchar,
  	"role_en" varchar,
  	"consent" boolean DEFAULT false
  );
  
  CREATE TABLE "cms"."pages_blocks_testimonial" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_cta" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"body_vi" varchar,
  	"body_en" varchar,
  	"button_label_vi" varchar,
  	"button_label_en" varchar,
  	"button_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title_vi" varchar,
  	"title_en" varchar,
  	"slug" varchar,
  	"seo_title_vi" varchar,
  	"seo_title_en" varchar,
  	"seo_description_vi" varchar,
  	"seo_description_en" varchar,
  	"seo_og_image_id" uuid,
  	"seo_canonical" varchar,
  	"seo_noindex" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "cms"."enum_pages_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_hero" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow_vi" varchar,
  	"eyebrow_en" varchar,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"subheading_vi" varchar,
  	"subheading_en" varchar,
  	"primary_cta_label_vi" varchar,
  	"primary_cta_label_en" varchar,
  	"primary_cta_href" varchar,
  	"secondary_cta_label_vi" varchar,
  	"secondary_cta_label_en" varchar,
  	"secondary_cta_href" varchar,
  	"image_id" uuid,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_features_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"icon" varchar,
  	"title_vi" varchar,
  	"title_en" varchar,
  	"body_vi" varchar,
  	"body_en" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_features" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_pricing" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"note_vi" varchar,
  	"note_en" varchar,
  	"program" "cms"."enum__pages_v_blocks_pricing_program" DEFAULT 'toeic',
  	"highlight_plan_code" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_faq_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"question_vi" varchar,
  	"question_en" varchar,
  	"answer_vi" varchar,
  	"answer_en" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_testimonial_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"quote_vi" varchar,
  	"quote_en" varchar,
  	"name" varchar,
  	"role_vi" varchar,
  	"role_en" varchar,
  	"consent" boolean DEFAULT false,
  	"_uuid" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_testimonial" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_cta" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading_vi" varchar,
  	"heading_en" varchar,
  	"body_vi" varchar,
  	"body_en" varchar,
  	"button_label_vi" varchar,
  	"button_label_en" varchar,
  	"button_href" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_title_vi" varchar,
  	"version_title_en" varchar,
  	"version_slug" varchar,
  	"version_seo_title_vi" varchar,
  	"version_seo_title_en" varchar,
  	"version_seo_description_vi" varchar,
  	"version_seo_description_en" varchar,
  	"version_seo_og_image_id" uuid,
  	"version_seo_canonical" varchar,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "cms"."enum__pages_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "cms"."redirects" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"from" varchar NOT NULL,
  	"to" varchar NOT NULL,
  	"type" "cms"."enum_redirects_type" DEFAULT '301' NOT NULL,
  	"enabled" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "marketing_media_id" uuid;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "categories_id" uuid;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "authors_id" uuid;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "posts_id" uuid;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "pages_id" uuid;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "redirects_id" uuid;
  ALTER TABLE "cms"."authors" ADD CONSTRAINT "authors_avatar_id_marketing_media_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."posts_faq" ADD CONSTRAINT "posts_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."posts" ADD CONSTRAINT "posts_cover_image_id_marketing_media_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."posts" ADD CONSTRAINT "posts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "cms"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."posts" ADD CONSTRAINT "posts_seo_og_image_id_marketing_media_id_fk" FOREIGN KEY ("seo_og_image_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."posts_rels" ADD CONSTRAINT "posts_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."posts_rels" ADD CONSTRAINT "posts_rels_authors_fk" FOREIGN KEY ("authors_id") REFERENCES "cms"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v_version_faq" ADD CONSTRAINT "_posts_v_version_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v" ADD CONSTRAINT "_posts_v_parent_id_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."posts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v" ADD CONSTRAINT "_posts_v_version_cover_image_id_marketing_media_id_fk" FOREIGN KEY ("version_cover_image_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v" ADD CONSTRAINT "_posts_v_version_category_id_categories_id_fk" FOREIGN KEY ("version_category_id") REFERENCES "cms"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v" ADD CONSTRAINT "_posts_v_version_seo_og_image_id_marketing_media_id_fk" FOREIGN KEY ("version_seo_og_image_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_authors_fk" FOREIGN KEY ("authors_id") REFERENCES "cms"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_hero" ADD CONSTRAINT "pages_blocks_hero_image_id_marketing_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_hero" ADD CONSTRAINT "pages_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_features_items" ADD CONSTRAINT "pages_blocks_features_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages_blocks_features"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_features" ADD CONSTRAINT "pages_blocks_features_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_pricing" ADD CONSTRAINT "pages_blocks_pricing_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_faq_items" ADD CONSTRAINT "pages_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_faq" ADD CONSTRAINT "pages_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_testimonial_items" ADD CONSTRAINT "pages_blocks_testimonial_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages_blocks_testimonial"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_testimonial" ADD CONSTRAINT "pages_blocks_testimonial_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_cta" ADD CONSTRAINT "pages_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages" ADD CONSTRAINT "pages_seo_og_image_id_marketing_media_id_fk" FOREIGN KEY ("seo_og_image_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_hero" ADD CONSTRAINT "_pages_v_blocks_hero_image_id_marketing_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_hero" ADD CONSTRAINT "_pages_v_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_features_items" ADD CONSTRAINT "_pages_v_blocks_features_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v_blocks_features"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_features" ADD CONSTRAINT "_pages_v_blocks_features_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_pricing" ADD CONSTRAINT "_pages_v_blocks_pricing_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_faq_items" ADD CONSTRAINT "_pages_v_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_faq" ADD CONSTRAINT "_pages_v_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_testimonial_items" ADD CONSTRAINT "_pages_v_blocks_testimonial_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v_blocks_testimonial"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_testimonial" ADD CONSTRAINT "_pages_v_blocks_testimonial_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_cta" ADD CONSTRAINT "_pages_v_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v" ADD CONSTRAINT "_pages_v_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."pages"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v" ADD CONSTRAINT "_pages_v_version_seo_og_image_id_marketing_media_id_fk" FOREIGN KEY ("version_seo_og_image_id") REFERENCES "cms"."marketing_media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "marketing_media_updated_at_idx" ON "cms"."marketing_media" USING btree ("updated_at");
  CREATE INDEX "marketing_media_created_at_idx" ON "cms"."marketing_media" USING btree ("created_at");
  CREATE UNIQUE INDEX "marketing_media_filename_idx" ON "cms"."marketing_media" USING btree ("filename");
  CREATE INDEX "marketing_media_sizes_card_sizes_card_filename_idx" ON "cms"."marketing_media" USING btree ("sizes_card_filename");
  CREATE INDEX "marketing_media_sizes_og_sizes_og_filename_idx" ON "cms"."marketing_media" USING btree ("sizes_og_filename");
  CREATE UNIQUE INDEX "categories_slug_idx" ON "cms"."categories" USING btree ("slug");
  CREATE INDEX "categories_updated_at_idx" ON "cms"."categories" USING btree ("updated_at");
  CREATE INDEX "categories_created_at_idx" ON "cms"."categories" USING btree ("created_at");
  CREATE UNIQUE INDEX "authors_slug_idx" ON "cms"."authors" USING btree ("slug");
  CREATE INDEX "authors_avatar_idx" ON "cms"."authors" USING btree ("avatar_id");
  CREATE INDEX "authors_updated_at_idx" ON "cms"."authors" USING btree ("updated_at");
  CREATE INDEX "authors_created_at_idx" ON "cms"."authors" USING btree ("created_at");
  CREATE INDEX "posts_faq_order_idx" ON "cms"."posts_faq" USING btree ("_order");
  CREATE INDEX "posts_faq_parent_id_idx" ON "cms"."posts_faq" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "posts_slug_idx" ON "cms"."posts" USING btree ("slug");
  CREATE INDEX "posts_cover_image_idx" ON "cms"."posts" USING btree ("cover_image_id");
  CREATE INDEX "posts_category_idx" ON "cms"."posts" USING btree ("category_id");
  CREATE INDEX "posts_seo_seo_og_image_idx" ON "cms"."posts" USING btree ("seo_og_image_id");
  CREATE INDEX "posts_updated_at_idx" ON "cms"."posts" USING btree ("updated_at");
  CREATE INDEX "posts_created_at_idx" ON "cms"."posts" USING btree ("created_at");
  CREATE INDEX "posts__status_idx" ON "cms"."posts" USING btree ("_status");
  CREATE INDEX "posts_rels_order_idx" ON "cms"."posts_rels" USING btree ("order");
  CREATE INDEX "posts_rels_parent_idx" ON "cms"."posts_rels" USING btree ("parent_id");
  CREATE INDEX "posts_rels_path_idx" ON "cms"."posts_rels" USING btree ("path");
  CREATE INDEX "posts_rels_authors_id_idx" ON "cms"."posts_rels" USING btree ("authors_id");
  CREATE INDEX "_posts_v_version_faq_order_idx" ON "cms"."_posts_v_version_faq" USING btree ("_order");
  CREATE INDEX "_posts_v_version_faq_parent_id_idx" ON "cms"."_posts_v_version_faq" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_parent_idx" ON "cms"."_posts_v" USING btree ("parent_id");
  CREATE INDEX "_posts_v_version_version_slug_idx" ON "cms"."_posts_v" USING btree ("version_slug");
  CREATE INDEX "_posts_v_version_version_cover_image_idx" ON "cms"."_posts_v" USING btree ("version_cover_image_id");
  CREATE INDEX "_posts_v_version_version_category_idx" ON "cms"."_posts_v" USING btree ("version_category_id");
  CREATE INDEX "_posts_v_version_seo_version_seo_og_image_idx" ON "cms"."_posts_v" USING btree ("version_seo_og_image_id");
  CREATE INDEX "_posts_v_version_version_updated_at_idx" ON "cms"."_posts_v" USING btree ("version_updated_at");
  CREATE INDEX "_posts_v_version_version_created_at_idx" ON "cms"."_posts_v" USING btree ("version_created_at");
  CREATE INDEX "_posts_v_version_version__status_idx" ON "cms"."_posts_v" USING btree ("version__status");
  CREATE INDEX "_posts_v_created_at_idx" ON "cms"."_posts_v" USING btree ("created_at");
  CREATE INDEX "_posts_v_updated_at_idx" ON "cms"."_posts_v" USING btree ("updated_at");
  CREATE INDEX "_posts_v_latest_idx" ON "cms"."_posts_v" USING btree ("latest");
  CREATE INDEX "_posts_v_rels_order_idx" ON "cms"."_posts_v_rels" USING btree ("order");
  CREATE INDEX "_posts_v_rels_parent_idx" ON "cms"."_posts_v_rels" USING btree ("parent_id");
  CREATE INDEX "_posts_v_rels_path_idx" ON "cms"."_posts_v_rels" USING btree ("path");
  CREATE INDEX "_posts_v_rels_authors_id_idx" ON "cms"."_posts_v_rels" USING btree ("authors_id");
  CREATE INDEX "pages_blocks_hero_order_idx" ON "cms"."pages_blocks_hero" USING btree ("_order");
  CREATE INDEX "pages_blocks_hero_parent_id_idx" ON "cms"."pages_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_hero_path_idx" ON "cms"."pages_blocks_hero" USING btree ("_path");
  CREATE INDEX "pages_blocks_hero_image_idx" ON "cms"."pages_blocks_hero" USING btree ("image_id");
  CREATE INDEX "pages_blocks_features_items_order_idx" ON "cms"."pages_blocks_features_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_features_items_parent_id_idx" ON "cms"."pages_blocks_features_items" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_features_order_idx" ON "cms"."pages_blocks_features" USING btree ("_order");
  CREATE INDEX "pages_blocks_features_parent_id_idx" ON "cms"."pages_blocks_features" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_features_path_idx" ON "cms"."pages_blocks_features" USING btree ("_path");
  CREATE INDEX "pages_blocks_pricing_order_idx" ON "cms"."pages_blocks_pricing" USING btree ("_order");
  CREATE INDEX "pages_blocks_pricing_parent_id_idx" ON "cms"."pages_blocks_pricing" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_pricing_path_idx" ON "cms"."pages_blocks_pricing" USING btree ("_path");
  CREATE INDEX "pages_blocks_faq_items_order_idx" ON "cms"."pages_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_faq_items_parent_id_idx" ON "cms"."pages_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_faq_order_idx" ON "cms"."pages_blocks_faq" USING btree ("_order");
  CREATE INDEX "pages_blocks_faq_parent_id_idx" ON "cms"."pages_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_faq_path_idx" ON "cms"."pages_blocks_faq" USING btree ("_path");
  CREATE INDEX "pages_blocks_testimonial_items_order_idx" ON "cms"."pages_blocks_testimonial_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_testimonial_items_parent_id_idx" ON "cms"."pages_blocks_testimonial_items" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_testimonial_order_idx" ON "cms"."pages_blocks_testimonial" USING btree ("_order");
  CREATE INDEX "pages_blocks_testimonial_parent_id_idx" ON "cms"."pages_blocks_testimonial" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_testimonial_path_idx" ON "cms"."pages_blocks_testimonial" USING btree ("_path");
  CREATE INDEX "pages_blocks_cta_order_idx" ON "cms"."pages_blocks_cta" USING btree ("_order");
  CREATE INDEX "pages_blocks_cta_parent_id_idx" ON "cms"."pages_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_cta_path_idx" ON "cms"."pages_blocks_cta" USING btree ("_path");
  CREATE UNIQUE INDEX "pages_slug_idx" ON "cms"."pages" USING btree ("slug");
  CREATE INDEX "pages_seo_seo_og_image_idx" ON "cms"."pages" USING btree ("seo_og_image_id");
  CREATE INDEX "pages_updated_at_idx" ON "cms"."pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "cms"."pages" USING btree ("created_at");
  CREATE INDEX "pages__status_idx" ON "cms"."pages" USING btree ("_status");
  CREATE INDEX "_pages_v_blocks_hero_order_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hero_parent_id_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_hero_path_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_hero_image_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("image_id");
  CREATE INDEX "_pages_v_blocks_features_items_order_idx" ON "cms"."_pages_v_blocks_features_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_features_items_parent_id_idx" ON "cms"."_pages_v_blocks_features_items" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_features_order_idx" ON "cms"."_pages_v_blocks_features" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_features_parent_id_idx" ON "cms"."_pages_v_blocks_features" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_features_path_idx" ON "cms"."_pages_v_blocks_features" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_pricing_order_idx" ON "cms"."_pages_v_blocks_pricing" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_pricing_parent_id_idx" ON "cms"."_pages_v_blocks_pricing" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_pricing_path_idx" ON "cms"."_pages_v_blocks_pricing" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_faq_items_order_idx" ON "cms"."_pages_v_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_faq_items_parent_id_idx" ON "cms"."_pages_v_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_faq_order_idx" ON "cms"."_pages_v_blocks_faq" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_faq_parent_id_idx" ON "cms"."_pages_v_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_faq_path_idx" ON "cms"."_pages_v_blocks_faq" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_testimonial_items_order_idx" ON "cms"."_pages_v_blocks_testimonial_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_testimonial_items_parent_id_idx" ON "cms"."_pages_v_blocks_testimonial_items" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_testimonial_order_idx" ON "cms"."_pages_v_blocks_testimonial" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_testimonial_parent_id_idx" ON "cms"."_pages_v_blocks_testimonial" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_testimonial_path_idx" ON "cms"."_pages_v_blocks_testimonial" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_cta_order_idx" ON "cms"."_pages_v_blocks_cta" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_cta_parent_id_idx" ON "cms"."_pages_v_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_cta_path_idx" ON "cms"."_pages_v_blocks_cta" USING btree ("_path");
  CREATE INDEX "_pages_v_parent_idx" ON "cms"."_pages_v" USING btree ("parent_id");
  CREATE INDEX "_pages_v_version_version_slug_idx" ON "cms"."_pages_v" USING btree ("version_slug");
  CREATE INDEX "_pages_v_version_seo_version_seo_og_image_idx" ON "cms"."_pages_v" USING btree ("version_seo_og_image_id");
  CREATE INDEX "_pages_v_version_version_updated_at_idx" ON "cms"."_pages_v" USING btree ("version_updated_at");
  CREATE INDEX "_pages_v_version_version_created_at_idx" ON "cms"."_pages_v" USING btree ("version_created_at");
  CREATE INDEX "_pages_v_version_version__status_idx" ON "cms"."_pages_v" USING btree ("version__status");
  CREATE INDEX "_pages_v_created_at_idx" ON "cms"."_pages_v" USING btree ("created_at");
  CREATE INDEX "_pages_v_updated_at_idx" ON "cms"."_pages_v" USING btree ("updated_at");
  CREATE INDEX "_pages_v_latest_idx" ON "cms"."_pages_v" USING btree ("latest");
  CREATE UNIQUE INDEX "redirects_from_idx" ON "cms"."redirects" USING btree ("from");
  CREATE INDEX "redirects_updated_at_idx" ON "cms"."redirects" USING btree ("updated_at");
  CREATE INDEX "redirects_created_at_idx" ON "cms"."redirects" USING btree ("created_at");
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_marketing_media_fk" FOREIGN KEY ("marketing_media_id") REFERENCES "cms"."marketing_media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "cms"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_authors_fk" FOREIGN KEY ("authors_id") REFERENCES "cms"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_posts_fk" FOREIGN KEY ("posts_id") REFERENCES "cms"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_redirects_fk" FOREIGN KEY ("redirects_id") REFERENCES "cms"."redirects"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_marketing_media_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("marketing_media_id");
  CREATE INDEX "payload_locked_documents_rels_categories_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("categories_id");
  CREATE INDEX "payload_locked_documents_rels_authors_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("authors_id");
  CREATE INDEX "payload_locked_documents_rels_posts_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("posts_id");
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("pages_id");
  CREATE INDEX "payload_locked_documents_rels_redirects_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("redirects_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cms"."marketing_media" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."categories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."authors" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."posts_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."posts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."posts_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_posts_v_version_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_posts_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_posts_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_hero" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_features_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_features" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_pricing" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_faq_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_testimonial_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_testimonial" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages_blocks_cta" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."pages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_hero" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_features_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_features" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_pricing" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_faq_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_testimonial_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_testimonial" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v_blocks_cta" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_pages_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."redirects" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "cms"."marketing_media" CASCADE;
  DROP TABLE "cms"."categories" CASCADE;
  DROP TABLE "cms"."authors" CASCADE;
  DROP TABLE "cms"."posts_faq" CASCADE;
  DROP TABLE "cms"."posts" CASCADE;
  DROP TABLE "cms"."posts_rels" CASCADE;
  DROP TABLE "cms"."_posts_v_version_faq" CASCADE;
  DROP TABLE "cms"."_posts_v" CASCADE;
  DROP TABLE "cms"."_posts_v_rels" CASCADE;
  DROP TABLE "cms"."pages_blocks_hero" CASCADE;
  DROP TABLE "cms"."pages_blocks_features_items" CASCADE;
  DROP TABLE "cms"."pages_blocks_features" CASCADE;
  DROP TABLE "cms"."pages_blocks_pricing" CASCADE;
  DROP TABLE "cms"."pages_blocks_faq_items" CASCADE;
  DROP TABLE "cms"."pages_blocks_faq" CASCADE;
  DROP TABLE "cms"."pages_blocks_testimonial_items" CASCADE;
  DROP TABLE "cms"."pages_blocks_testimonial" CASCADE;
  DROP TABLE "cms"."pages_blocks_cta" CASCADE;
  DROP TABLE "cms"."pages" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_hero" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_features_items" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_features" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_pricing" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_faq_items" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_faq" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_testimonial_items" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_testimonial" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_cta" CASCADE;
  DROP TABLE "cms"."_pages_v" CASCADE;
  DROP TABLE "cms"."redirects" CASCADE;
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_marketing_media_fk";
  
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_categories_fk";
  
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_authors_fk";
  
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_posts_fk";
  
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_pages_fk";
  
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_redirects_fk";
  
  DROP INDEX "cms"."payload_locked_documents_rels_marketing_media_id_idx";
  DROP INDEX "cms"."payload_locked_documents_rels_categories_id_idx";
  DROP INDEX "cms"."payload_locked_documents_rels_authors_id_idx";
  DROP INDEX "cms"."payload_locked_documents_rels_posts_id_idx";
  DROP INDEX "cms"."payload_locked_documents_rels_pages_id_idx";
  DROP INDEX "cms"."payload_locked_documents_rels_redirects_id_idx";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "marketing_media_id";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "categories_id";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "authors_id";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "posts_id";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "pages_id";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "redirects_id";
  DROP TYPE "cms"."enum_posts_program";
  DROP TYPE "cms"."enum_posts_schema_type";
  DROP TYPE "cms"."enum_posts_status";
  DROP TYPE "cms"."enum__posts_v_version_program";
  DROP TYPE "cms"."enum__posts_v_version_schema_type";
  DROP TYPE "cms"."enum__posts_v_version_status";
  DROP TYPE "cms"."enum_pages_blocks_pricing_program";
  DROP TYPE "cms"."enum_pages_status";
  DROP TYPE "cms"."enum__pages_v_blocks_pricing_program";
  DROP TYPE "cms"."enum__pages_v_version_status";
  DROP TYPE "cms"."enum_redirects_type";`)
}
