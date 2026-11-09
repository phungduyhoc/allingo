import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "cms"."enum_test_sets_ielts_module" AS ENUM('academic', 'general_training');
  ALTER TABLE "cms"."test_sets" ADD COLUMN "ielts_module" "cms"."enum_test_sets_ielts_module";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cms"."test_sets" DROP COLUMN "ielts_module";
  DROP TYPE "cms"."enum_test_sets_ielts_module";`)
}
