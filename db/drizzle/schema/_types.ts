import { customType } from 'drizzle-orm/pg-core';

/** Kiểu citext (email không phân biệt hoa thường) */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});
