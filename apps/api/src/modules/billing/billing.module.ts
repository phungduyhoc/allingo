import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { CreditService } from './credit.service.js';
import { EntitlementService } from './entitlement.service.js';
import { QuotaService } from './quota.service.js';

@Module({
  controllers: [BillingController],
  providers: [EntitlementService, QuotaService, CreditService],
  exports: [EntitlementService, QuotaService, CreditService],
})
export class BillingModule {}
