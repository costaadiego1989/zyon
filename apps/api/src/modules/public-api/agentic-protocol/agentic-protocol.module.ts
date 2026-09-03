import { Module } from '@nestjs/common';
import { AgentRulesModule } from '../../agent-rules/agent-rules.module.js';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { CheckoutModule } from '../../checkout/checkout.module.js';
import { MerchantModule } from '../../merchant/merchant.module.js';
import { EmbedModule } from '../../embed/embed.module.js';
import { PaymentModule } from '../../payment/payment.module.js';
import { CouponsModule } from '../../coupons/coupons.module.js';
import { AgenticProtocolController } from './agentic-protocol.controller.js';
import { ProductFeedService } from './product-feed.service.js';
import { AcpBearerGuard } from './acp-bearer.guard.js';
import { AcpCheckoutLifecycleService } from './acp-checkout-lifecycle.service.js';
import { AcpStatusPolicy } from './acp-status.policy.js';
import { AcpMutabilityPolicy } from './acp-mutability.policy.js';
import { AcpLineItemsResolver } from './acp-line-items.resolver.js';
import { AcpBuyerMerger } from './acp-buyer.merger.js';
import { AcpCouponApplier } from './acp-coupon.applier.js';
import { AcpFulfillmentSelector } from './acp-fulfillment.selector.js';
import { AcpPaymentOrchestrator } from './acp-payment.orchestrator.js';
import { AcpStoreDomainService } from './acp-store-domain.service.js';

@Module({
  imports: [
    AgentRulesModule,
    CatalogModule,
    CheckoutModule,
    MerchantModule,
    EmbedModule,
    PaymentModule,
    CouponsModule,
  ],
  controllers: [AgenticProtocolController],
  providers: [
    ProductFeedService,
    AcpBearerGuard,
    AcpCheckoutLifecycleService,
    AcpStatusPolicy,
    AcpMutabilityPolicy,
    AcpLineItemsResolver,
    AcpBuyerMerger,
    AcpCouponApplier,
    AcpFulfillmentSelector,
    AcpPaymentOrchestrator,
    AcpStoreDomainService,
  ],
  exports: [
    AcpBearerGuard,
    AcpCheckoutLifecycleService,
    AcpStatusPolicy,
    AcpMutabilityPolicy,
    AcpLineItemsResolver,
    AcpBuyerMerger,
    AcpCouponApplier,
    AcpFulfillmentSelector,
    AcpPaymentOrchestrator,
    AcpStoreDomainService,
  ],
})
export class AgenticProtocolModule {}
