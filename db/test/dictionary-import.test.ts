import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { normalizeLookupTerm } from '@allingo/schemas';
import { createDb, type Db } from '../src/index.js';
import * as schema from '../drizzle/schema/index.js';
import { seedCatalog } from '../seed/index.js';
import { formatAttribution, importDictionary, loadDictionaryModule, normalizePos, seedDictionary, toVocabRow, type DictEntry } from '../seed/dictionary.js';

/**
 * Importer từ điển (Sprint 6): ánh xạ DictEntry → catalog.vocab_items, idempotent, nhận hàng demo cùng headword (giữ id),
 * forms chuẩn hoá bằng normalizeLookupTerm (cùng hàm API tra). Dùng fixture nhỏ; tệp dữ liệu thật (agent nội dung) được kiểm
 * tra thêm khi đã có. DB riêng `allingo_dicttest` (tạo lại mỗi lần) để không đụng test DB khác chạy song song.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../drizzle/migrations');
const base = process.env.TEST_DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo_test';
const dbUrl = (() => {
  const u = new URL(base);
  u.pathname = '/allingo_dicttest';
  return u.toString();
})();
const dataFile = path.resolve(here, '../seed/dictionary/toeic-core-en-vi.ts');

const FIXTURE: DictEntry[] = [
  { headword: 'invoice', pos: 'noun', ipa_us: '/ˈɪnvɔɪs/', ipa_uk: '/ˈɪnvɔɪs/', meanings: [{ vi: 'hoá đơn', en: 'a list of goods sent or services provided, with prices' }], examples: [{ en: 'Please pay the invoice within 30 days.', vi: 'Vui lòng thanh toán hoá đơn trong 30 ngày.' }], collocations: ['issue an invoice', 'pay an invoice'], level: 'B1', topics: ['Finance'], forms: ['invoices', 'Invoiced', 'invoicing'] },
  { headword: 'record', pos: 'noun', ipa_us: '/ˈrekərd/', ipa_uk: '/ˈrekɔːd/', meanings: [{ vi: 'hồ sơ, bản ghi', en: 'a written account' }], examples: [], collocations: [], level: 'B1', topics: ['office'], forms: ['records'] },
  { headword: 'record', pos: 'verb', ipa_us: '/rɪˈkɔːrd/', ipa_uk: '/rɪˈkɔːd/', meanings: [{ vi: 'ghi lại', en: 'to write down or store' }], examples: [], collocations: [], level: 'B1', topics: ['office'], forms: ['records', 'recorded', 'recording'] },
  { headword: 'shipment', pos: 'noun', meanings: [{ vi: 'lô hàng', en: 'goods sent together' }], examples: [], collocations: [], level: 'B1', topics: ['logistics'], forms: ['shipments'] },
  // trùng headword + từ loại → bỏ qua
  { headword: 'Shipment', pos: 'noun', meanings: [{ vi: 'trùng', en: 'dup' }], examples: [], collocations: [], topics: [], forms: [] },
];

let db: Db;
let raw: Sql;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`DROP DATABASE IF EXISTS allingo_dicttest WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE allingo_dicttest`);
  await admin.end();
  raw = postgres(dbUrl, { max: 1, onnotice: () => undefined });
  await migrate(drizzle(raw), { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  const c = createDb({ url: dbUrl, max: 2 });
  db = c.db;
  closeDb = () => c.sql.end();
  await seedCatalog(db);
});

afterAll(async () => {
  await closeDb?.();
  await raw?.end();
});

describe('dictionary importer', () => {
  it('toVocabRow: forms chuẩn hoá gồm headword, examples i18n, topics chữ thường', () => {
    const r = toVocabRow(FIXTURE[0]!);
    expect(r.forms).toEqual(['invoice', 'invoices', 'invoiced', 'invoicing']);
    expect(r.examples[0]).toEqual({ text: 'Please pay the invoice within 30 days.', translation: { vi: 'Vui lòng thanh toán hoá đơn trong 30 ngày.' } });
    expect(r.topics).toEqual(['finance']);
    expect(r).toMatchObject({ kind: 'word', source: 'human', status: 'published', programCode: 'toeic' });
    expect(normalizePos('n')).toBe('noun');
    expect(normalizePos('adj.')).toBe('adjective');
  });

  it('nhận hàng demo cùng headword (giữ id), chèn mục mới, bỏ trùng; chạy lại không đổi gì', async () => {
    const [demo] = await db
      .insert(schema.catalogVocabItems)
      .values({ programCode: 'toeic', kind: 'word', headword: 'invoice', pos: 'n', ipaUk: '/x/', ipaUs: '/x/', meanings: [{ vi: 'hoá đơn', en: 'bill' }], examples: [{ text: 'demo' }], collocations: [], level: 'B1', source: 'human', status: 'published' })
      .returning({ id: schema.catalogVocabItems.id });
    const r1 = await importDictionary(db, FIXTURE);
    expect(r1).toEqual({ total: 5, inserted: 3, updated: 1, unchanged: 0, skipped: 1 });
    const inv = await db.select().from(schema.catalogVocabItems).where(and(eq(schema.catalogVocabItems.programCode, 'toeic'), eq(schema.catalogVocabItems.headword, 'invoice')));
    expect(inv).toHaveLength(1);
    expect(inv[0]!.id).toBe(demo!.id);
    expect(inv[0]).toMatchObject({ pos: 'noun', ipaUs: '/ˈɪnvɔɪs/', forms: ['invoice', 'invoices', 'invoiced', 'invoicing'], topics: ['finance'] });
    const records = await db.select({ pos: schema.catalogVocabItems.pos }).from(schema.catalogVocabItems).where(eq(schema.catalogVocabItems.headword, 'record'));
    expect(records.map((x) => x.pos).sort()).toEqual(['noun', 'verb']);
    const r2 = await importDictionary(db, FIXTURE);
    expect(r2).toEqual({ total: 5, inserted: 0, updated: 0, unchanged: 4, skipped: 1 });
    // Tra ngược qua GIN forms
    const byForm = await db.select({ headword: schema.catalogVocabItems.headword }).from(schema.catalogVocabItems).where(sql`${schema.catalogVocabItems.forms} @> array[${'recorded'}]::text[]`);
    expect(byForm.map((x) => x.headword)).toEqual(['record']);
  });

  it('dữ liệu thay đổi → cập nhật đúng hàng (theo từ loại), không tạo trùng', async () => {
    const changed = FIXTURE.map((e) => (e.headword === 'record' && e.pos === 'verb' ? { ...e, meanings: [{ vi: 'ghi âm, ghi lại', en: 'to store sound or facts' }] } : e));
    const r = await importDictionary(db, changed);
    expect(r).toMatchObject({ inserted: 0, updated: 1, unchanged: 3 });
    const [verb] = await db.select().from(schema.catalogVocabItems).where(and(eq(schema.catalogVocabItems.headword, 'record'), eq(schema.catalogVocabItems.pos, 'verb')));
    expect(verb!.meanings).toEqual([{ vi: 'ghi âm, ghi lại', en: 'to store sound or facts' }]);
  });

  it('loadDictionaryModule: tệp không tồn tại → null; formatAttribution nhận chuỗi/object', async () => {
    expect(await loadDictionaryModule('./dictionary/__missing__.js')).toBeNull();
    expect(formatAttribution('CC BY-SA 4.0 – Allingo')).toBe('CC BY-SA 4.0 – Allingo');
    expect(formatAttribution({ name: 'Allingo TOEIC Core EN–VI', license: 'CC BY 4.0' })).toBe('Allingo TOEIC Core EN–VI · CC BY 4.0');
    expect(formatAttribution({ attribution: 'Nguồn: Allingo' })).toBe('Nguồn: Allingo');
    expect(formatAttribution(null)).toBeNull();
  });

  it.skipIf(!fs.existsSync(dataFile))('tệp dữ liệu thật: nhập ≥ 700 mục, idempotent, forms khớp normalizeLookupTerm', async () => {
    const mod = await loadDictionaryModule();
    expect(mod).not.toBeNull();
    expect(mod!.DICTIONARY_TOEIC_CORE.length).toBeGreaterThanOrEqual(700);
    if (mod!.normalizeTerm) {
      // Hàm chuẩn hoá của tệp dữ liệu phải trùng hàm API dùng khi tra (nếu lệch, forms trong DB vẫn theo normalizeLookupTerm)
      const sample = mod!.DICTIONARY_TOEIC_CORE.slice(0, 200).flatMap((e) => [e.headword, ...e.forms]);
      const mismatch = sample.filter((t) => mod!.normalizeTerm!(t) !== normalizeLookupTerm(t));
      expect(mismatch).toEqual([]);
    }
    const r1 = await seedDictionary(db);
    expect(r1!.inserted + r1!.updated + r1!.unchanged).toBeGreaterThanOrEqual(700 - r1!.skipped);
    const r2 = await seedDictionary(db);
    expect(r2!.inserted).toBe(0);
    expect(r2!.updated).toBe(0);
  });
});
