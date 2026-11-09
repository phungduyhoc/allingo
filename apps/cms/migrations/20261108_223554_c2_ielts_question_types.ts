import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'matching_headings';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'matching_information';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'matching_features';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'matching_sentence_endings';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'sentence_completion';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'summary_completion';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'note_completion';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'table_completion';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'flow_chart_completion';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'form_completion';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'short_answer';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'diagram_labelling';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'summary_word_bank';
  ALTER TYPE "cms"."enum_questions_question_type" ADD VALUE 'plan_map_labelling';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cms"."questions" ALTER COLUMN "question_type" SET DATA TYPE text;
  ALTER TABLE "cms"."questions" ALTER COLUMN "question_type" SET DEFAULT 'mcq_single'::text;
  DROP TYPE "cms"."enum_questions_question_type";
  CREATE TYPE "cms"."enum_questions_question_type" AS ENUM('mcq_single', 'mcq_multi', 'fill_blank', 'matching', 'drag_drop', 'map_label', 'tfng', 'ordering', 'dictation', 'essay', 'speaking', 'handwriting');
  ALTER TABLE "cms"."questions" ALTER COLUMN "question_type" SET DEFAULT 'mcq_single'::"cms"."enum_questions_question_type";
  ALTER TABLE "cms"."questions" ALTER COLUMN "question_type" SET DATA TYPE "cms"."enum_questions_question_type" USING "question_type"::"cms"."enum_questions_question_type";`)
}
