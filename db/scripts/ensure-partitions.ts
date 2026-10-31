 
import { createDb } from '../src/client.js';
import { ensureMonthPartitions } from '../src/partitions.js';

const url =
  process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo';
const { db, sql } = createDb({ url, max: 1 });
try {
  const created = await ensureMonthPartitions(db, 2);
  console.log('partitions ok:', created.join(', '));
} finally {
  await sql.end();
}
