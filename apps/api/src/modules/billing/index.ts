// Giao diện công khai của module billing
export { BillingModule } from './billing.module.js';
export { EntitlementService, type EntitlementContext, type PlanKind } from './entitlement.service.js';
export { QuotaService, periodKey, periodResetAt, type QuotaStatus, type QuotaPeriod } from './quota.service.js';
export { CreditService, type CreditReason } from './credit.service.js';
export { FeatureGateService, type GateTicket } from './feature-gate.service.js';
export { FeatureFlagService, evaluateFlag } from './feature-flags.service.js';
export { BillingJobsService, BILLING_JOB_INTERVALS } from './billing-jobs.service.js';
export { OrdersService, CHECKOUT_FLAG } from './orders.service.js';
export { PaymentsService } from './payments.service.js';
export { SubscriptionsService } from './subscriptions.service.js';
export { ReconciliationService } from './reconciliation.service.js';
export { PaymentProviderRegistry } from './payments/provider-registry.js';
export type { PaymentProvider, CreatePaymentInput, CreatePaymentResult, ParsedWebhook, HttpClient, WebhookInput, WebhookOutcome } from './payments/payment-provider.js';
export { MockPaymentProvider, signMockWebhook, type MockWebhookPayload } from './payments/mock.provider.js';
export { VnpayProvider, vnpaySign, vnpaySignData } from './payments/vnpay.provider.js';
export { MomoProvider, momoRaw } from './payments/momo.provider.js';
export { ZalopayProvider } from './payments/zalopay.provider.js';
export { encodeMerchantRef, decodeMerchantRef } from './payments/merchant-ref.js';
