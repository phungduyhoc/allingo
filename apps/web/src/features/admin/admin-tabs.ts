/** Tab admin billing (S8) – module thường (không 'use client') để proxy kiểm tra `/admin/billing/<tab>` (B6/S152) */
export const ADMIN_TABS = ['overview', 'orders', 'payments', 'invoices', 'subscriptions', 'credits', 'dead-letters', 'reconciliations', 'promotions', 'jobs'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];
