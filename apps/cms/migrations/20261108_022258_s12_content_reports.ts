import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "cms"."enum_content_reports_status" AS ENUM('open', 'confirmed', 'rejected', 'fixed');
  CREATE TYPE "cms"."enum_content_reports_reason" AS ENUM('wrong_answer', 'typo', 'unclear', 'audio_issue', 'image_issue', 'translation', 'explanation_wrong', 'other');
  CREATE TABLE "cms"."content_reports" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"report_id" varchar NOT NULL,
  	"status" "cms"."enum_content_reports_status" DEFAULT 'open' NOT NULL,
  	"overdue" boolean,
  	"sla_due_at" timestamp(3) with time zone,
  	"resolution_note" varchar,
  	"reason" "cms"."enum_content_reports_reason" NOT NULL,
  	"reports_for_question" numeric,
  	"message" varchar,
  	"stem_preview" varchar,
  	"external_ref" varchar,
  	"section_code" varchar,
  	"version_no" numeric,
  	"question_id" varchar,
  	"question_version_id" varchar NOT NULL,
  	"reported_at" timestamp(3) with time zone,
  	"resolved_at" timestamp(3) with time zone,
  	"api_updated_at" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "content_reports_id" uuid;
  CREATE UNIQUE INDEX "content_reports_report_id_idx" ON "cms"."content_reports" USING btree ("report_id");
  CREATE INDEX "content_reports_updated_at_idx" ON "cms"."content_reports" USING btree ("updated_at");
  CREATE INDEX "content_reports_created_at_idx" ON "cms"."content_reports" USING btree ("created_at");
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_content_reports_fk" FOREIGN KEY ("content_reports_id") REFERENCES "cms"."content_reports"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_content_reports_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("content_reports_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cms"."content_reports" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "cms"."content_reports" CASCADE;
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_content_reports_fk";
  
  DROP INDEX "cms"."payload_locked_documents_rels_content_reports_id_idx";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "content_reports_id";
  DROP TYPE "cms"."enum_content_reports_status";
  DROP TYPE "cms"."enum_content_reports_reason";`)
}
