import { Module } from '@nestjs/common';
import { BillingAdminController } from './billing-admin.controller.js';
import { BillingAdminService } from './billing-admin.service.js';
import { BillingController } from './billing.controller.js';
import { BillingJobsService } from './billing-jobs.service.js';
import { CreditService } from './credit.service.js';
import { EntitlementService } from './entitlement.service.js';
import { FeatureFlagService } from './feature-flags.service.js';
import { FeatureGateService } from './feature-gate.service.js';
import { FulfillmentService } from './fulfillment.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentProviderRegistry } from './payments/provider-registry.js';
import { PaymentsService } from './payments.service.js';
import { PlansService } from './plans.service.js';
import { PromotionsService } from './promotions.service.js';
import { QuotaService } from './quota.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { WebhooksController } from './webhooks.controller.js';

/**
 * billing (tầng 1): entitlement/quota/credit (S5) + đơn hàng, 3 cổng thanh toán webhook-first, subscription, gating,
 * đối soát (S7 – ADR-0012). Giao diện công khai: index.ts.
 */
@Module({
  controllers: [BillingController, OrdersController, WebhooksController, BillingAdminController],
  providers: [
    EntitlementService,
    QuotaService,
    CreditService,
    FeatureGateService,
    FeatureFlagService,
    PlansService,
    PromotionsService,
    PaymentProviderRegistry,
    FulfillmentService,
    OrdersService,
    PaymentsService,
    SubscriptionsService,
    BillingAdminService,
    ReconciliationService,
    BillingJobsService,
  ],
  exports: [EntitlementService, QuotaService, CreditService, FeatureGateService, FeatureFlagService, BillingJobsService, PaymentProviderRegistry, PaymentsService, SubscriptionsService, OrdersService, ReconciliationService],
})
export class BillingModule {}
