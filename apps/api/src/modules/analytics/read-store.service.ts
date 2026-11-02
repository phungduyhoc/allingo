import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { DbService, type Tx } from '../../shared/db/db.module.js';

/**
 * Kho đọc của analytics (CLAUDE.md §5.1 – ngoại lệ được truy vấn bảng của module khác): `DATABASE_URL_REPLICA` nếu có, không thì
 * cùng DB chính. Mọi truy vấn chạy trong transaction `READ ONLY` (bảo vệ khi lỡ ghi; replica vốn chỉ đọc).
 */
@Injectable()
export class ReadStoreService {
  readonly usesReplica: boolean;

  constructor(
    private readonly dbs: DbService,
    @Inject(ENV) env: Env,
  ) {
    this.usesReplica = !!env.DATABASE_URL_REPLICA;
  }

  async read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.dbs.replica.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      return fn(tx);
    });
  }
}
