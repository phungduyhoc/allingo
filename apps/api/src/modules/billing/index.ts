// Giao diện công khai của module billing
export { BillingModule } from './billing.module.js';
export { EntitlementService, type EntitlementContext, type PlanKind } from './entitlement.service.js';
export { QuotaService, periodKey, periodResetAt, type QuotaStatus, type QuotaPeriod } from './quota.service.js';
export { CreditService, type CreditReason } from './credit.service.js';
export type { PaymentProvider, CreatePaymentInput, CreatePaymentResult, ParsedWebhook } from './payment-provider.js';
export { MockPaymentProvider } from './payment-provider.js';
