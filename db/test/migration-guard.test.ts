import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkMigrationSql, guardFile, sha256, splitStatements } from '../src/migration-guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../drizzle/migrations');

/** S11 – migration an toàn: CI chặn DROP/RENAME/khoá bảng không có cờ cho phép */
describe('migration-guard', () => {
  it('chặn DROP/RENAME/ALTER TYPE/SET NOT NULL/TRUNCATE/DELETE không WHERE/CREATE INDEX khoá bảng', () => {
    const sql = [
      'ALTER TABLE learn.notes DROP COLUMN body;',
      'DROP TABLE ops.feedback;',
      'ALTER TABLE learn.notes RENAME COLUMN body TO content;',
      'ALTER TABLE iam.users RENAME TO members;',
      'ALTER TABLE learn.notes ALTER COLUMN body TYPE varchar(100);',
      'ALTER TABLE learn.notes ALTER COLUMN body SET NOT NULL;',
      'ALTER TABLE learn.notes ADD COLUMN x int NOT NULL;',
      'TRUNCATE ops.outbox;',
      'DELETE FROM ops.outbox;',
      'UPDATE iam.users SET status = \'blocked\';',
      'CREATE INDEX ix_a ON learn.notes(user_id);',
    ].join('\n--> statement-breakpoint\n');
    const rules = checkMigrationSql('x.sql', sql).map((v) => v.rule);
    expect(rules).toEqual(['drop', 'drop', 'rename', 'rename', 'alter_type', 'set_not_null', 'add_column_not_null_no_default', 'truncate', 'delete_without_where', 'update_without_where', 'create_index_blocking']);
  });

  it('cho phép khi có cờ `-- migration-guard: allow <lý do>`, CONCURRENTLY, concurrent-safe, index trên bảng mới, DEFAULT', () => {
    const sql = `-- migration-guard: allow contract S12: cột cũ đã ngừng dùng từ bản 1.4
ALTER TABLE learn.notes DROP COLUMN legacy;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY ix_b ON learn.notes(kind);
--> statement-breakpoint
-- concurrent-safe
CREATE INDEX IF NOT EXISTS ix_c ON learn.notes(updated_at);
--> statement-breakpoint
CREATE TABLE ops.new_table (id uuid PRIMARY KEY, n int NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE INDEX ix_new ON ops.new_table(n);
--> statement-breakpoint
ALTER TABLE learn.notes ADD COLUMN y int NOT NULL DEFAULT 0;
--> statement-breakpoint
DELETE FROM ops.outbox WHERE created_at < now() - interval '30 days';`;
    expect(guardFile('ok.sql', sql)).toEqual([]);
  });

  it('cờ allow phải có lý do ≥ 10 ký tự; DROP trong chú thích/chuỗi không bị bắt', () => {
    expect(checkMigrationSql('a.sql', '-- migration-guard: allow x\nDROP TABLE a.b;').map((v) => v.rule)).toEqual(['drop']);
    expect(checkMigrationSql('b.sql', "-- DROP TABLE a.b (ghi chú)\nCOMMENT ON TABLE a.b IS 'DROP TABLE x';")).toEqual([]);
  });

  it('splitStatements giữ khối $$ … $$ nguyên vẹn', () => {
    const st = splitStatements("DO $$ BEGIN\n  PERFORM 1;\nEND $$;\nSELECT 2;");
    expect(st).toHaveLength(2);
    expect(st[0]!.sql).toContain('PERFORM 1;');
  });

  it('migration trong repo: baseline đúng sha256, migration mới (0008+) không vi phạm', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(dir, '.guard-baseline.json'), 'utf8')) as Record<string, string>;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      if (baseline[f]) expect(sha256(text), f).toBe(baseline[f]);
      else expect(guardFile(f, text), f).toEqual([]);
    }
    expect(Object.keys(baseline)).toContain('0001_init.sql');
  });
});
