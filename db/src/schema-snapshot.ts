import type { Sql } from 'postgres';

/**
 * Chụp "ảnh" cấu trúc DB (6 schema nghiệp vụ) từ pg_catalog để so sánh hai database với nhau
 * (docs/spec/allingo-schema.sql vs db/drizzle/migrations). Không phụ thuộc pg_dump.
 */
export const BUSINESS_SCHEMAS = ['iam', 'catalog', 'learn', 'ai', 'billing', 'ops'] as const;

export interface SchemaSnapshot {
  tables: Record<string, { kind: string; partition_by: string | null; columns: Record<string, string>; rls: boolean }>;
  constraints: Record<string, string>;
  indexes: Record<string, string>;
  enums: Record<string, string[]>;
  functions: Record<string, string>;
  views: Record<string, string>;
  policies: Record<string, string>;
  sequences: string[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function snapshotSchema(sql: Sql): Promise<SchemaSnapshot> {
  const schemas = [...BUSINESS_SCHEMAS];
  const tables = await sql<{ schema: string; name: string; kind: string; partition_by: string | null; rls: boolean }[]>`
    SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind, pg_get_partkeydef(c.oid) AS partition_by, c.relrowsecurity AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY(${schemas}) AND c.relkind IN ('r','p') AND NOT c.relispartition
    ORDER BY 1,2`;
  const columns = await sql<
    {
      schema: string;
      table: string;
      name: string;
      type: string;
      notnull: boolean;
      def: string | null;
      identity: string;
      generated: string;
    }[]
  >`
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS def, a.attidentity AS identity, a.attgenerated AS generated
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = ANY(${schemas}) AND c.relkind IN ('r','p') AND NOT c.relispartition AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY 1,2,a.attnum`;
  const constraints = await sql<{ schema: string; table: string; name: string; def: string }[]>`
    SELECT n.nspname AS schema, c.relname AS table, con.conname AS name, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY(${schemas}) AND NOT c.relispartition ORDER BY 1,2,3`;
  const indexes = await sql<{ schema: string; table: string; name: string; def: string }[]>`
    SELECT schemaname AS schema, tablename AS table, indexname AS name, indexdef AS def FROM pg_indexes
    WHERE schemaname = ANY(${schemas}) AND tablename !~ '_[0-9]{6}$' ORDER BY 1,2,3`;
  const enums = await sql<{ schema: string; name: string; labels: string[] }[]>`
    SELECT n.nspname AS schema, t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = ANY(${schemas}) GROUP BY 1,2 ORDER BY 1,2`;
  const functions = await sql<{ schema: string; name: string; def: string }[]>`
    SELECT n.nspname AS schema, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY(${schemas}) ORDER BY 1,2`;
  const views = await sql<{ schema: string; name: string; def: string }[]>`
    SELECT schemaname AS schema, viewname AS name, definition AS def FROM pg_views WHERE schemaname = ANY(${schemas}) ORDER BY 1,2`;
  const policies = await sql<
    {
      schema: string;
      table: string;
      name: string;
      cmd: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }[]
  >`
    SELECT schemaname AS schema, tablename AS table, policyname AS name, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname = ANY(${schemas}) ORDER BY 1,2,3`;
  const sequences = await sql<{ schema: string; name: string }[]>`
    SELECT sequence_schema AS schema, sequence_name AS name FROM information_schema.sequences WHERE sequence_schema = ANY(${schemas}) ORDER BY 1,2`;

  const snap: SchemaSnapshot = {
    tables: {},
    constraints: {},
    indexes: {},
    enums: {},
    functions: {},
    views: {},
    policies: {},
    sequences: [],
  };
  for (const t of tables)
    snap.tables[`${t.schema}.${t.name}`] = { kind: t.kind, partition_by: t.partition_by, columns: {}, rls: t.rls };
  for (const c of columns) {
    const key = `${c.schema}.${c.table}`;
    const t = snap.tables[key];
    if (!t) continue;
    const parts = [c.type, c.notnull ? 'NOT NULL' : 'NULL'];
    if (c.def) parts.push(`DEFAULT ${norm(c.def)}`);
    if (c.identity) parts.push(`IDENTITY ${c.identity}`);
    if (c.generated) parts.push(`GENERATED ${c.generated}`);
    t.columns[c.name] = parts.join(' ');
  }
  for (const c of constraints) snap.constraints[`${c.schema}.${c.table}.${c.name}`] = norm(c.def);
  for (const i of indexes) snap.indexes[`${i.schema}.${i.table}.${i.name}`] = norm(i.def);
  for (const e of enums) snap.enums[`${e.schema}.${e.name}`] = e.labels;
  for (const f of functions) snap.functions[`${f.schema}.${f.name}`] = norm(f.def);
  for (const v of views) snap.views[`${v.schema}.${v.name}`] = norm(v.def);
  for (const p of policies)
    snap.policies[`${p.schema}.${p.table}.${p.name}`] = norm(
      `${p.cmd} TO ${p.roles.join(',')} USING ${p.qual ?? ''} WITH CHECK ${p.with_check ?? ''}`,
    );
  snap.sequences = sequences.map((s) => `${s.schema}.${s.name}`);
  return snap;
}

export interface SnapshotDiff {
  path: string;
  left: unknown;
  right: unknown;
}

/** So sánh hai snapshot; trả danh sách khác biệt (rỗng = tương đương) */
export function diffSnapshots(left: SchemaSnapshot, right: SchemaSnapshot): SnapshotDiff[] {
  const out: SnapshotDiff[] = [];
  const cmpRecord = (prefix: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      const l = a[k];
      const r = b[k];
      if (JSON.stringify(l) !== JSON.stringify(r)) out.push({ path: `${prefix}.${k}`, left: l, right: r });
    }
  };
  const tableKeys = new Set([...Object.keys(left.tables), ...Object.keys(right.tables)]);
  for (const k of [...tableKeys].sort()) {
    const l = left.tables[k];
    const r = right.tables[k];
    if (!l || !r) {
      out.push({ path: `tables.${k}`, left: l ? 'present' : 'missing', right: r ? 'present' : 'missing' });
      continue;
    }
    if (l.kind !== r.kind || l.partition_by !== r.partition_by || l.rls !== r.rls)
      out.push({
        path: `tables.${k}.meta`,
        left: { kind: l.kind, partition_by: l.partition_by, rls: l.rls },
        right: { kind: r.kind, partition_by: r.partition_by, rls: r.rls },
      });
    cmpRecord(`tables.${k}.columns`, l.columns, r.columns);
  }
  cmpRecord('constraints', left.constraints, right.constraints);
  cmpRecord('indexes', left.indexes, right.indexes);
  cmpRecord('enums', left.enums, right.enums);
  cmpRecord('functions', left.functions, right.functions);
  cmpRecord('views', left.views, right.views);
  cmpRecord('policies', left.policies, right.policies);
  if (JSON.stringify(left.sequences) !== JSON.stringify(right.sequences))
    out.push({ path: 'sequences', left: left.sequences, right: right.sequences });
  return out;
}
