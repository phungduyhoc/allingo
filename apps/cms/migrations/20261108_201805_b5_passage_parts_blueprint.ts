import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "cms"."passages_parts" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar NOT NULL
  );
  
  CREATE TABLE "cms"."test_sets_blueprint" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"section_code" varchar NOT NULL,
  	"count" numeric NOT NULL
  );
  
  ALTER TABLE "cms"."passages_parts" ADD CONSTRAINT "passages_parts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."passages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."test_sets_blueprint" ADD CONSTRAINT "test_sets_blueprint_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."test_sets"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "passages_parts_order_idx" ON "cms"."passages_parts" USING btree ("_order");
  CREATE INDEX "passages_parts_parent_id_idx" ON "cms"."passages_parts" USING btree ("_parent_id");
  CREATE INDEX "test_sets_blueprint_order_idx" ON "cms"."test_sets_blueprint" USING btree ("_order");
  CREATE INDEX "test_sets_blueprint_parent_id_idx" ON "cms"."test_sets_blueprint" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "cms"."passages_parts" CASCADE;
  DROP TABLE "cms"."test_sets_blueprint" CASCADE;`)
}
