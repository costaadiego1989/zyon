import { PrismaMarketplaceCancellationRepository } from "./infrastructure/repositories/prisma-marketplace-cancellation.repository.js";
import { PrismaMarketplaceUnsubmittedCancellationRepository } from "./infrastructure/repositories/prisma-marketplace-unsubmitted-cancellation.repository.js";
import { MARKETPLACE_UNSUBMITTED_CANCELLATION_REPOSITORY } from "./domain/ports/marketplace-unsubmitted-cancellation.port.js";
import { MarketplaceCancellationAdapter } from "./infrastructure/marketplace-cancellation.adapter.js";
import { ReconcileMarketplaceCancellationUseCase } from "./application/use-cases/reconcile-marketplace-cancellation.use-case.js";
import { ExecuteMarketplaceCancellationUseCase } from "./application/use-cases/execute-marketplace-cancellation.use-case.js";
import { PrismaMarketplaceFinancialRepository } from "./infrastructure/repositories/prisma-marketplace-financial.repository.js";
import { PrismaMarketplaceCartRepository } from "./infrastructure/repositories/prisma-marketplace-cart.repository.js";
import { MarketplaceFinancialEventsHandler } from "./application/handlers/marketplace-financial-events.handler.js";
import { PrismaMarketplacePayoutRepository } from "./infrastructure/repositories/prisma-marketplace-payout.repository.js";
import { MarketplacePayoutAdapter } from "./infrastructure/marketplace-payout.adapter.js";
import { MarketplaceCaptureAdapter } from "./infrastructure/marketplace-capture.adapter.js";
import { MarketplaceNativeRecoveryAdapter } from "./infrastructure/marketplace-native-recovery.adapter.js";
import { PrismaMarketplaceNativeRecoveryRepository } from "./infrastructure/repositories/prisma-marketplace-native-recovery.repository.js";
import { ReconcileMarketplaceNativeRecoveryUseCase } from "./application/use-cases/reconcile-marketplace-native-recovery.use-case.js";
import { PrismaMarketplaceFundingRepository } from "./infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { FundMarketplaceOrderUseCase } from "./application/use-cases/fund-marketplace-order.use-case.js";
import { ExecuteMarketplacePayoutUseCase } from "./application/use-cases/execute-marketplace-payout.use-case.js";
import { readAsaasConnection } from "../payment/infrastructure/asaas-env.js";
import { readStripeConnection } from "../payment/infrastructure/stripe-env.js";
import { readMercadoPagoConnection } from "../payment/infrastructure/mercadopago-env.js";
import { Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { MarketplaceRefundDashboardService } from "./application/marketplace-refund-dashboard.service.js";
import { MarketplaceRefundDashboardController } from "./presentation/http/marketplace-refund-dashboard.controller.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { ShippingQuotesModule } from "../shipping/shipping-quotes.module.js";
import { MarketplaceMetricsService } from "./infrastructure/marketplace-metrics.service.js";
import { MarketplaceReadinessAuditService } from "./infrastructure/marketplace-readiness-audit.service.js";
import { PrismaMarketplaceRefundRepository } from "./infrastructure/repositories/prisma-marketplace-refund.repository.js";
import { MarketplaceRefundAdapter } from "./infrastructure/marketplace-refund.adapter.js";
import { ExecuteMarketplaceRefundUseCase } from "./application/use-cases/execute-marketplace-refund.use-case.js";
import { ReconcileMarketplaceRefundsJob } from "./infrastructure/jobs/reconcile-marketplace-refunds.job.js";
import { ReconcileMarketplaceRecoveryJob } from "./infrastructure/jobs/reconcile-marketplace-recovery.job.js";
import { PrismaMarketplaceResidualRepository } from "./infrastructure/repositories/prisma-marketplace-residual.repository.js";
import { MarketplaceResidualAdapter } from "./infrastructure/marketplace-residual.adapter.js";
import { AsaasMarketplaceResidualAdapter } from "./infrastructure/asaas-marketplace-residual.adapter.js";
import { AsaasMarketplaceTransferRecoveryAdapter } from "./infrastructure/asaas-marketplace-transfer-recovery.adapter.js";
import { PrismaAsaasMarketplaceResidualAuthorizationRepository, PrismaAsaasMarketplaceResidualAccountReader }
  from "./infrastructure/repositories/prisma-asaas-marketplace-residual-authorization.repository.js";
import { ExecuteMarketplaceResidualUseCase } from "./application/use-cases/execute-marketplace-residual.use-case.js";
import { StripeMarketplaceSuccessiveResidualAdapter } from "./infrastructure/stripe-marketplace-successive-residual.adapter.js";
import { PrismaStripeMarketplaceSuccessiveResidualGenerationRepository } from "./infrastructure/repositories/prisma-stripe-marketplace-successive-residual-generation.repository.js";
import { STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_GENERATION_REPOSITORY, STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_CERTIFICATION_PROVIDER } from "./domain/ports/stripe-marketplace-successive-residual.port.js";
import { StripeMarketplaceSuccessiveResidualCertificationService } from "./application/stripe-marketplace-successive-residual-certification.service.js";
import { PrismaAsaasMarketplaceHostRetentionRepository, ASAAS_MARKETPLACE_HOST_RETENTION_VERIFIER, ASAAS_MARKETPLACE_HOST_RETENTION_JOURNAL } from "./infrastructure/repositories/prisma-asaas-marketplace-host-retention.repository.js";
import { AsaasMarketplaceHostRetentionNativeVerifier } from "./infrastructure/asaas-marketplace-host-retention.verifier.js";
import { MarketplaceAsaasHostRetentionService } from "./application/services/marketplace-asaas-host-retention.service.js";
import { MarketplaceResidualGenerationCertificationCoordinator } from "./application/marketplace-residual-generation-coordinator.js";
import { PrismaMarketplaceTransferReversalRepository } from "./infrastructure/repositories/prisma-marketplace-transfer-reversal.repository.js";
import { ExecuteMarketplaceTransferReversalUseCase } from "./application/use-cases/execute-marketplace-transfer-reversal.use-case.js";
import { MarketplaceJobMetricsService } from "./infrastructure/marketplace-job-metrics.service.js";
import { FundMarketplaceOrdersJob } from "./infrastructure/jobs/fund-marketplace-orders.job.js";
import { PrismaMarketplaceOrderDisputeClosureRepository } from "./infrastructure/repositories/prisma-marketplace-order-dispute-closure.repository.js";
import { ReconcileMarketplaceOrderDisputeClosureUseCase } from "./application/use-cases/reconcile-marketplace-order-dispute-closure.use-case.js";
import { MarketplaceOrderDisputeClosureController } from "./presentation/http/marketplace-order-dispute-closure.controller.js";
import { MARKETPLACE_ORDER_DISPUTE_CLOSURE_REPOSITORY } from "./domain/ports/marketplace-order-dispute-closure.port.js";
import { MarketplaceHostDisputeMetricsService } from "./infrastructure/marketplace-host-dispute-metrics.service.js";
import { PrismaMarketplaceDisputeClosureRepository } from "./infrastructure/repositories/prisma-marketplace-dispute-closure.repository.js";
import { StripeMarketplaceDisputeClosureAdapter } from "./infrastructure/stripe-marketplace-dispute-closure.adapter.js";
import { ReconcileMarketplaceDisputeClosureUseCase } from "./application/use-cases/reconcile-marketplace-dispute-closure.use-case.js";
import { MarketplaceDisputeClosureController } from "./presentation/http/marketplace-dispute-closure.controller.js";
import { MarketplaceRefundContributionAdapter } from "./infrastructure/marketplace-refund-contribution.adapter.js";
import { PrismaMarketplaceRefundContributionRepository } from "./infrastructure/repositories/prisma-marketplace-refund-contribution.repository.js";
import { MarketplaceRefundContributionService } from "./application/marketplace-refund-contribution.service.js";
import { MarketplaceRefundContributionController } from "./presentation/http/marketplace-refund-contribution.controller.js";
import { MARKETPLACE_REFUND_CONTRIBUTION_PROVIDER } from "./domain/ports/marketplace-refund-contribution.port.js";
import { MARKETPLACE_REFUND_CONTRIBUTION_JOURNAL, MARKETPLACE_REFUND_CONTRIBUTION_ACTIVATOR } from "./domain/ports/marketplace-refund-contribution-journal.port.js";
import { PrismaAsaasMarketplaceWalletReturnRepository } from "./infrastructure/repositories/prisma-asaas-marketplace-wallet-return.repository.js";
import { MarketplaceAsaasWalletReturnService } from "./application/marketplace-asaas-wallet-return.service.js";
import { PrismaAsaasMarketplaceResidualWalletReturnRepository } from "./infrastructure/repositories/prisma-asaas-marketplace-residual-wallet-return.repository.js";
import { MarketplaceAsaasResidualWalletReturnService } from "./application/marketplace-asaas-residual-wallet-return.service.js";
import { MarketplaceAsaasWalletReturnDashboardService } from "./application/marketplace-asaas-wallet-return-dashboard.service.js";
import { MarketplaceAsaasWalletReturnController } from "./presentation/http/marketplace-asaas-wallet-return.controller.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";
import { MarketplaceFundingJournalMetricsService } from "./infrastructure/marketplace-funding-journal-metrics.service.js";
import { MarketplaceShippingFinancialMetricsService } from "./infrastructure/marketplace-shipping-financial-metrics.service.js";
import { MarketplaceContributionCollectionMetricsService } from "./infrastructure/marketplace-contribution-collection-metrics.service.js";
import { MarketplaceContributionCheckoutService } from "./application/marketplace-contribution-checkout.service.js";
import { MarketplaceContributionCheckoutController } from "./presentation/http/marketplace-contribution-checkout.controller.js";
import { PrismaMarketplaceContributionCheckoutRepository } from "./infrastructure/repositories/prisma-marketplace-contribution-checkout.repository.js";
import { StripeMarketplaceContributionCheckoutAdapter } from "./infrastructure/stripe-marketplace-contribution-checkout.adapter.js";
import { MARKETPLACE_CONTRIBUTION_CHECKOUT_PROVIDER, MARKETPLACE_CONTRIBUTION_CHECKOUT_REPOSITORY } from "./domain/ports/marketplace-contribution-checkout.port.js";
import { MarketplaceHostFeeCollectionService } from "./application/marketplace-host-fee-collection.service.js";
import { MarketplaceHostFeeCollectionController } from "./presentation/http/marketplace-host-fee-collection.controller.js";
import { PrismaMarketplaceHostFeeCollectionRepository } from "./infrastructure/repositories/prisma-marketplace-host-fee-collection.repository.js";
import { StripeMarketplaceHostFeeCollectionAdapter } from "./infrastructure/stripe-marketplace-host-fee-collection.adapter.js";
import { MARKETPLACE_HOST_FEE_COLLECTION_REPOSITORY, MARKETPLACE_HOST_FEE_COLLECTION_PROVIDER } from "./domain/ports/marketplace-host-fee-collection.port.js";
import { MarketplaceSellerFeeCollectionService } from "./application/marketplace-seller-fee-collection.service.js";
import { MarketplaceSellerFeeCollectionController } from "./presentation/http/marketplace-seller-fee-collection.controller.js";
import { PrismaMarketplaceSellerFeeCollectionRepository } from "./infrastructure/repositories/prisma-marketplace-seller-fee-collection.repository.js";
import { StripeMarketplaceSellerFeeCollectionAdapter } from "./infrastructure/stripe-marketplace-seller-fee-collection.adapter.js";
import { MARKETPLACE_SELLER_FEE_COLLECTION_REPOSITORY, MARKETPLACE_SELLER_FEE_COLLECTION_PROVIDER } from "./domain/ports/marketplace-seller-fee-collection.port.js";

import { MARKETPLACE_CONFIG_REPOSITORY } from "./domain/ports/marketplace-config-repository.port.js";
import { FEDERATED_PRODUCT_REPOSITORY } from "./domain/ports/federated-product-repository.port.js";
import { CROSS_STORE_ORDER_REPOSITORY } from "./domain/ports/cross-store-order-repository.port.js";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "./domain/ports/marketplace-settlement-repository.port.js";
import { MARKETPLACE_SELLER_DEBT_REPOSITORY } from "./domain/ports/marketplace-seller-debt-repository.port.js";

import { PrismaMarketplaceConfigRepository } from "./infrastructure/repositories/prisma-marketplace-config.repository.js";
import { PrismaFederatedProductRepository } from "./infrastructure/repositories/prisma-federated-product.repository.js";
import { PrismaCrossStoreOrderRepository } from "./infrastructure/repositories/prisma-cross-store-order.repository.js";
import { PrismaMarketplaceSettlementRepository } from "./infrastructure/repositories/prisma-marketplace-settlement.repository.js";
import { PrismaMarketplaceSellerDebtRepository } from "./infrastructure/repositories/prisma-marketplace-seller-debt.repository.js";

import { CommissionCalculatorService } from "./domain/services/commission-calculator.service.js";
import { FederatedSearchService } from "./domain/services/federated-search.service.js";
import { SettlementStateMachineService } from "./domain/services/settlement-state-machine.service.js";

import { SearchFederatedProductsUseCase } from "./application/use-cases/search-federated-products.use-case.js";
import { AddCrossStoreItemUseCase } from "./application/use-cases/add-cross-store-item.use-case.js";
import { PlaceCrossStoreOrderUseCase } from "./application/use-cases/place-cross-store-order.use-case.js";
import { UpdateMarketplaceConfigUseCase } from "./application/use-cases/update-marketplace-config.use-case.js";
import { SyncMerchantProductsUseCase } from "./application/use-cases/sync-merchant-products.use-case.js";
import { HandleMarketplaceChargebackUseCase } from "./application/use-cases/handle-marketplace-chargeback.use-case.js";
import { RegisterMarketplaceReturnUseCase } from "./application/use-cases/register-marketplace-return.use-case.js";
import { ProcessScheduledTransfersUseCase } from "./application/use-cases/process-scheduled-transfers.use-case.js";
import { GetSellerOrdersUseCase } from "./application/use-cases/get-seller-orders.use-case.js";
import { GetSellerStatsUseCase } from "./application/use-cases/get-seller-stats.use-case.js";
import { UpdateMarketplaceFulfillmentUseCase } from "./application/use-cases/update-marketplace-fulfillment.use-case.js";
import { ListSellerSettlementsUseCase } from "./application/use-cases/list-seller-settlements.use-case.js";
import { GetSettlementDetailUseCase } from "./application/use-cases/get-settlement-detail.use-case.js";
import { ListSellerDebtsUseCase } from "./application/use-cases/list-seller-debts.use-case.js";
import { GetDebtDetailUseCase } from "./application/use-cases/get-debt-detail.use-case.js";
import { ListMarketplaceChargebacksUseCase } from "./application/use-cases/list-marketplace-chargebacks.use-case.js";
import { ListMarketplaceEventsUseCase } from "./application/use-cases/list-marketplace-events.use-case.js";
import { ListPartnerStoresUseCase } from "./application/use-cases/list-partner-stores.use-case.js";

import { SyncMarketplaceIndexJob } from "./infrastructure/jobs/sync-marketplace-index.job.js";
import { ProcessTransfersJob } from "./infrastructure/jobs/process-transfers.job.js";
import { FinalizeSettlementsJob } from "./infrastructure/jobs/finalize-settlements.job.js";
import { MarketplaceCatalogSyncScheduler, MarketplaceCatalogSyncWorker } from "./application/handlers/marketplace-catalog-sync.handler.js";

import { MarketplaceController } from "./presentation/http/marketplace.controller.js";
import { MarketplaceDiscoveryController } from "./presentation/http/marketplace-discovery.controller.js";
import { MarketplaceCancellationController } from "./presentation/http/marketplace-cancellation.controller.js";
import { MarketplaceCancellationDashboardService } from "./application/marketplace-cancellation-dashboard.service.js";
import { MarketplaceOperationalEventsHandler } from "./application/handlers/marketplace-operational-events.handler.js";

const prismaProvider = {
  provide: PrismaClient,
  useExisting: PRISMA_CLIENT,
};


@Module({
  imports: [CatalogModule, ShippingQuotesModule],
  controllers: [MarketplaceController, MarketplaceDiscoveryController, MarketplaceCancellationController, MarketplaceRefundDashboardController,
    MarketplaceRefundContributionController, MarketplaceAsaasWalletReturnController, MarketplaceContributionCheckoutController, MarketplaceDisputeClosureController,
    MarketplaceSellerFeeCollectionController, MarketplaceHostFeeCollectionController, MarketplaceOrderDisputeClosureController],
  providers: [
    MarketplaceRefundDashboardService,
    prismaProvider,
    BillingPlanMeteringService,
    PlanLimitGuard,
    MarketplaceMetricsService,
    MarketplaceHostDisputeMetricsService,
    MarketplaceFundingJournalMetricsService,
    MarketplaceShippingFinancialMetricsService,
    MarketplaceContributionCollectionMetricsService,
    MarketplaceJobMetricsService,
    MarketplaceReadinessAuditService,
    MarketplaceOperationalEventsHandler,
    PrismaMarketplaceRefundRepository,
    { provide: PrismaMarketplaceRefundContributionRepository,
      useFactory: (prisma: PrismaClient, tenant: TenantContextService) => new PrismaMarketplaceRefundContributionRepository(prisma, tenant),
      inject: [PrismaClient, TenantContextService] },
    { provide: MARKETPLACE_REFUND_CONTRIBUTION_JOURNAL, useExisting: PrismaMarketplaceRefundContributionRepository },
    { provide: MARKETPLACE_REFUND_CONTRIBUTION_PROVIDER,
      useFactory: () => new MarketplaceRefundContributionAdapter({ stripeSecret: readStripeConnection().secretKey }) },
    { provide: MARKETPLACE_REFUND_CONTRIBUTION_ACTIVATOR,
      useFactory: (repo: PrismaMarketplaceRefundRepository, tenant: TenantContextService) => (hostMerchantId: string, refundPlanId: string) =>
        tenant.run({ merchantId: hostMerchantId, userId: "marketplace-refund-funding", role: "system" }, () => repo.activateFundedRefund(hostMerchantId, refundPlanId)),
      inject: [PrismaMarketplaceRefundRepository, TenantContextService] },
    MarketplaceRefundContributionService,
    { provide: PrismaMarketplaceContributionCheckoutRepository,
      useFactory: (prisma: PrismaClient, contributions: PrismaMarketplaceRefundContributionRepository, tenant: TenantContextService) =>
        new PrismaMarketplaceContributionCheckoutRepository(prisma, contributions, tenant),
      inject: [PrismaClient, PrismaMarketplaceRefundContributionRepository, TenantContextService] },
    { provide: MARKETPLACE_CONTRIBUTION_CHECKOUT_REPOSITORY, useExisting: PrismaMarketplaceContributionCheckoutRepository },
    { provide: MARKETPLACE_CONTRIBUTION_CHECKOUT_PROVIDER, useFactory: () => {
      let returnUrl = "";
      try {
        const configured = new URL(process.env.MERCHANT_CONSOLE_URL?.trim() || process.env.DASHBOARD_URL?.trim() || "");
        if (configured.protocol === "https:" && !configured.username && !configured.password && !configured.port) returnUrl = configured.origin;
      } catch { /* Missing configuration closes collection admission. */ }
      return new StripeMarketplaceContributionCheckoutAdapter({ stripeSecret: readStripeConnection().secretKey, returnUrl });
    } },
    MarketplaceContributionCheckoutService,
    { provide: PrismaMarketplaceSellerFeeCollectionRepository,
      useFactory: (prisma: PrismaClient, tenant: TenantContextService) => new PrismaMarketplaceSellerFeeCollectionRepository(prisma, tenant),
      inject: [PrismaClient, TenantContextService] },
    { provide: MARKETPLACE_SELLER_FEE_COLLECTION_REPOSITORY, useExisting: PrismaMarketplaceSellerFeeCollectionRepository },
    { provide: MARKETPLACE_SELLER_FEE_COLLECTION_PROVIDER, useFactory: () => {
      let returnUrl = "";
      try {
        const configured = new URL(process.env.MERCHANT_CONSOLE_URL?.trim() || process.env.DASHBOARD_URL?.trim() || "");
        if (configured.protocol === "https:" && !configured.username && !configured.password && !configured.port) returnUrl = configured.origin;
      } catch { /* Missing configuration closes fee collection admission. */ }
      return new StripeMarketplaceSellerFeeCollectionAdapter({ stripeSecret: readStripeConnection().secretKey, returnUrl });
    } },
    MarketplaceSellerFeeCollectionService,
    { provide: PrismaMarketplaceHostFeeCollectionRepository,
      useFactory: (prisma: PrismaClient, tenant: TenantContextService) => new PrismaMarketplaceHostFeeCollectionRepository(prisma, tenant),
      inject: [PrismaClient, TenantContextService] },
    { provide: MARKETPLACE_HOST_FEE_COLLECTION_REPOSITORY, useExisting: PrismaMarketplaceHostFeeCollectionRepository },
    { provide: MARKETPLACE_HOST_FEE_COLLECTION_PROVIDER, useFactory: () => {
      let returnUrl = "";
      try {
        const configured = new URL(process.env.MERCHANT_CONSOLE_URL?.trim() || process.env.DASHBOARD_URL?.trim() || "");
        if (configured.protocol === "https:" && !configured.username && !configured.password && !configured.port) returnUrl = configured.origin;
      } catch { /* Missing configuration closes host fee collection admission. */ }
      return new StripeMarketplaceHostFeeCollectionAdapter({ stripeSecret: readStripeConnection().secretKey, returnUrl });
    } },
    MarketplaceHostFeeCollectionService,
    PrismaAsaasMarketplaceWalletReturnRepository,
    { provide: MarketplaceAsaasWalletReturnService,
      useFactory: (repo: PrismaAsaasMarketplaceWalletReturnRepository, refunds: PrismaMarketplaceRefundRepository, tenant: TenantContextService) => {
        const asaas = readAsaasConnection();
        return new MarketplaceAsaasWalletReturnService(repo, { host: { asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl } }, globalThis.fetch, () => new Date(),
          (hostMerchantId: string, refundPlanId: string) => tenant.run({ merchantId: hostMerchantId, userId: "marketplace-wallet-return", role: "system" },
            () => refunds.activateReturnedFundsRefund(hostMerchantId, refundPlanId)));
      }, inject: [PrismaAsaasMarketplaceWalletReturnRepository, PrismaMarketplaceRefundRepository, TenantContextService] },
    PrismaAsaasMarketplaceResidualWalletReturnRepository,
    { provide: MarketplaceAsaasResidualWalletReturnService,
      useFactory: (repo: PrismaAsaasMarketplaceResidualWalletReturnRepository, refunds: PrismaMarketplaceRefundRepository, tenant: TenantContextService) => {
        const asaas = readAsaasConnection();
        return new MarketplaceAsaasResidualWalletReturnService(repo, { host: { asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl } }, globalThis.fetch, () => new Date(),
          (hostMerchantId: string, refundPlanId: string) => tenant.run({ merchantId: hostMerchantId, userId: "marketplace-residual-wallet-return", role: "system" },
            () => refunds.activateReturnedFundsRefund(hostMerchantId, refundPlanId)));
      }, inject: [PrismaAsaasMarketplaceResidualWalletReturnRepository, PrismaMarketplaceRefundRepository, TenantContextService] },
    { provide: MarketplaceAsaasWalletReturnDashboardService,
      useFactory: (initial: MarketplaceAsaasWalletReturnService, residual: MarketplaceAsaasResidualWalletReturnService,
        repo: PrismaAsaasMarketplaceResidualWalletReturnRepository, tenant: TenantContextService) =>
        new MarketplaceAsaasWalletReturnDashboardService(initial, residual,
          (actor, refundId, sourceId) => repo.sourceKindForActor(actor, refundId, sourceId), tenant),
      inject: [MarketplaceAsaasWalletReturnService, MarketplaceAsaasResidualWalletReturnService,
        PrismaAsaasMarketplaceResidualWalletReturnRepository, TenantContextService] },
    { provide: PrismaMarketplaceOrderDisputeClosureRepository,
      useFactory: (prisma: PrismaClient, tenant: TenantContextService) => new PrismaMarketplaceOrderDisputeClosureRepository(prisma, tenant),
      inject: [PrismaClient, TenantContextService] },
    { provide: MARKETPLACE_ORDER_DISPUTE_CLOSURE_REPOSITORY, useExisting: PrismaMarketplaceOrderDisputeClosureRepository },
    { provide: ReconcileMarketplaceOrderDisputeClosureUseCase,
      useFactory: (repo: PrismaMarketplaceOrderDisputeClosureRepository, disputes: PrismaMarketplaceDisputeClosureRepository) =>
        new ReconcileMarketplaceOrderDisputeClosureUseCase(repo, disputes,
          new StripeMarketplaceDisputeClosureAdapter({ stripeSecret: readStripeConnection().secretKey })),
      inject: [PrismaMarketplaceOrderDisputeClosureRepository, PrismaMarketplaceDisputeClosureRepository] },
    PrismaMarketplaceDisputeClosureRepository,
    { provide: ReconcileMarketplaceDisputeClosureUseCase,
      useFactory: (repo: PrismaMarketplaceDisputeClosureRepository) => new ReconcileMarketplaceDisputeClosureUseCase(repo,
        new StripeMarketplaceDisputeClosureAdapter({ stripeSecret: readStripeConnection().secretKey })),
      inject: [PrismaMarketplaceDisputeClosureRepository] },
    PrismaMarketplaceNativeRecoveryRepository,
    { provide: ReconcileMarketplaceNativeRecoveryUseCase,
      useFactory: (repo: PrismaMarketplaceNativeRecoveryRepository) => new ReconcileMarketplaceNativeRecoveryUseCase(repo,
        new MarketplaceNativeRecoveryAdapter({ stripeSecret: readStripeConnection().secretKey })),
      inject: [PrismaMarketplaceNativeRecoveryRepository] },
    { provide: ExecuteMarketplaceRefundUseCase,
      useFactory: (repo: PrismaMarketplaceRefundRepository, walletReturns: MarketplaceAsaasWalletReturnService,
        residualWalletReturns: MarketplaceAsaasResidualWalletReturnService) => {
        const asaas = readAsaasConnection();
        return new ExecuteMarketplaceRefundUseCase(repo, new MarketplaceRefundAdapter({
          stripeSecret: readStripeConnection().secretKey, asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl,
        }, globalThis.fetch, requests => walletReturns.verifyRefundReturns(requests),
          requests => residualWalletReturns.verifyRefundReturns(requests)));
      },
      inject: [PrismaMarketplaceRefundRepository, MarketplaceAsaasWalletReturnService, MarketplaceAsaasResidualWalletReturnService] },
    ReconcileMarketplaceRefundsJob,
    PrismaMarketplaceResidualRepository,
    PrismaAsaasMarketplaceResidualAuthorizationRepository,
    PrismaAsaasMarketplaceResidualAccountReader,
    { provide: PrismaStripeMarketplaceSuccessiveResidualGenerationRepository,
      useFactory: (prisma: PrismaClient, tenant: TenantContextService) => new PrismaStripeMarketplaceSuccessiveResidualGenerationRepository(prisma, tenant),
      inject: [PrismaClient, TenantContextService] },
    { provide: STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_GENERATION_REPOSITORY, useExisting: PrismaStripeMarketplaceSuccessiveResidualGenerationRepository },
    { provide: STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_CERTIFICATION_PROVIDER,
      useFactory: () => new StripeMarketplaceSuccessiveResidualAdapter({stripeSecret: readStripeConnection().secretKey}) },
    StripeMarketplaceSuccessiveResidualCertificationService,
    { provide: ASAAS_MARKETPLACE_HOST_RETENTION_VERIFIER,
      useFactory: (accounts: PrismaAsaasMarketplaceResidualAccountReader, walletReturns: PrismaAsaasMarketplaceWalletReturnRepository) => {
        const asaas = readAsaasConnection(), host = {asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl};
        return new AsaasMarketplaceHostRetentionNativeVerifier(accounts, {reconcile: async (request, providerTransferId) => {
          const sellerKey = await walletReturns.sellerConnection(request.seller.merchantId, request.environment, request.seller.walletId);
          return new AsaasMarketplaceTransferRecoveryAdapter({host, seller: {asaasKey: sellerKey, asaasOrigin: asaas.baseUrl}}, walletReturns, globalThis.fetch)
            .reconcile(request, providerTransferId);
        }});
      }, inject: [PrismaAsaasMarketplaceResidualAccountReader, PrismaAsaasMarketplaceWalletReturnRepository] },
    PrismaAsaasMarketplaceHostRetentionRepository,
    { provide: ASAAS_MARKETPLACE_HOST_RETENTION_JOURNAL, useExisting: PrismaAsaasMarketplaceHostRetentionRepository },
    MarketplaceAsaasHostRetentionService,
    { provide: MarketplaceResidualGenerationCertificationCoordinator,
      useFactory: (prisma: PrismaClient, stripe: StripeMarketplaceSuccessiveResidualCertificationService, asaas: MarketplaceAsaasHostRetentionService) =>
        new MarketplaceResidualGenerationCertificationCoordinator(prisma, stripe, asaas),
      inject: [PrismaClient, StripeMarketplaceSuccessiveResidualCertificationService, MarketplaceAsaasHostRetentionService] },
    PrismaMarketplaceTransferReversalRepository,
    { provide: ExecuteMarketplaceResidualUseCase,
      useFactory: (repo: PrismaMarketplaceResidualRepository, authorization: PrismaAsaasMarketplaceResidualAuthorizationRepository,
        accounts: PrismaAsaasMarketplaceResidualAccountReader, walletReturns: PrismaAsaasMarketplaceWalletReturnRepository,
        retention: PrismaAsaasMarketplaceHostRetentionRepository, retentionVerifier: AsaasMarketplaceHostRetentionNativeVerifier,
        generations: MarketplaceResidualGenerationCertificationCoordinator) => {
        const asaas = readAsaasConnection(), host = { asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl };
        const residual = new AsaasMarketplaceResidualAdapter(host, globalThis.fetch, authorization, accounts, {
          reconcile: async (request, providerTransferId) => {
            const sellerKey = await walletReturns.sellerConnection(request.seller.merchantId, request.environment, request.seller.walletId);
            return new AsaasMarketplaceTransferRecoveryAdapter({ host,
              seller: { asaasKey: sellerKey, asaasOrigin: asaas.baseUrl } }, walletReturns, globalThis.fetch)
              .reconcile(request, providerTransferId);
          },
        }, undefined, retention, retentionVerifier);
        return new ExecuteMarketplaceResidualUseCase(repo,
          new MarketplaceResidualAdapter({ stripeSecret: readStripeConnection().secretKey }, globalThis.fetch, residual), generations);
      },
      inject: [PrismaMarketplaceResidualRepository, PrismaAsaasMarketplaceResidualAuthorizationRepository,
        PrismaAsaasMarketplaceResidualAccountReader, PrismaAsaasMarketplaceWalletReturnRepository,
        PrismaAsaasMarketplaceHostRetentionRepository, ASAAS_MARKETPLACE_HOST_RETENTION_VERIFIER, MarketplaceResidualGenerationCertificationCoordinator] },
    { provide: ExecuteMarketplaceTransferReversalUseCase,
      useFactory: (repo: PrismaMarketplaceTransferReversalRepository) => {
        const asaas = readAsaasConnection();
        return new ExecuteMarketplaceTransferReversalUseCase(repo, new MarketplaceRefundAdapter({
          stripeSecret: readStripeConnection().secretKey, asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl,
        }));
      },
      inject: [PrismaMarketplaceTransferReversalRepository] },
    ReconcileMarketplaceRecoveryJob,
    PrismaMarketplaceCartRepository,
    PrismaMarketplaceFinancialRepository,
    PrismaMarketplaceCancellationRepository,
    PrismaMarketplaceUnsubmittedCancellationRepository,
    { provide: MARKETPLACE_UNSUBMITTED_CANCELLATION_REPOSITORY, useExisting: PrismaMarketplaceUnsubmittedCancellationRepository },
    MarketplaceCancellationDashboardService,
    { provide: ExecuteMarketplaceCancellationUseCase,
      useFactory: (repo: PrismaMarketplaceCancellationRepository) => {
        const mp = readMercadoPagoConnection();
        const asaas = readAsaasConnection();
        return new ExecuteMarketplaceCancellationUseCase(repo, new MarketplaceCancellationAdapter({ stripeSecret: readStripeConnection().secretKey,
          asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl,
          mercadoPago: { accessToken: mp.accessToken, baseUrl: mp.baseUrl, environment: mp.sandbox ? "test" : "live" } }));
      },
      inject: [PrismaMarketplaceCancellationRepository] },
    { provide: ReconcileMarketplaceCancellationUseCase,
      useFactory: (repo: PrismaMarketplaceCancellationRepository) => {
        const mp = readMercadoPagoConnection();
        const asaas = readAsaasConnection();
        return new ReconcileMarketplaceCancellationUseCase(repo, new MarketplaceCancellationAdapter({ stripeSecret: readStripeConnection().secretKey,
          asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl,
          mercadoPago: { accessToken: mp.accessToken, baseUrl: mp.baseUrl, environment: mp.sandbox ? "test" : "live" } }));
      },
      inject: [PrismaMarketplaceCancellationRepository] },
    MarketplaceFinancialEventsHandler,
    PrismaMarketplacePayoutRepository,
    PrismaMarketplaceFundingRepository,
    {
      provide: FundMarketplaceOrderUseCase,
      useFactory: (repo: PrismaMarketplaceFundingRepository) => {
        const asaas = readAsaasConnection();
        return new FundMarketplaceOrderUseCase(repo, new MarketplaceCaptureAdapter({ stripeSecret: readStripeConnection().secretKey,
          asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl }));
      },
      inject: [PrismaMarketplaceFundingRepository],
    },
    {
      provide: MarketplacePayoutAdapter,
      useFactory: () => {
        const asaas = readAsaasConnection();
        return new MarketplacePayoutAdapter({ stripeSecret: readStripeConnection().secretKey,
          asaasKey: asaas.apiKey, asaasOrigin: asaas.baseUrl });
      },
    },
    {
      provide: ExecuteMarketplacePayoutUseCase,
      useFactory: (repo: PrismaMarketplacePayoutRepository, provider: MarketplacePayoutAdapter) => new ExecuteMarketplacePayoutUseCase(repo, provider),
      inject: [PrismaMarketplacePayoutRepository, MarketplacePayoutAdapter],
    },

    // Repositories
    {
      provide: MARKETPLACE_CONFIG_REPOSITORY,
      useClass: PrismaMarketplaceConfigRepository,
    },
    {
      provide: FEDERATED_PRODUCT_REPOSITORY,
      useClass: PrismaFederatedProductRepository,
    },
    {
      provide: CROSS_STORE_ORDER_REPOSITORY,
      useClass: PrismaCrossStoreOrderRepository,
    },
    {
      provide: MARKETPLACE_SETTLEMENT_REPOSITORY,
      useClass: PrismaMarketplaceSettlementRepository,
    },
    {
      provide: MARKETPLACE_SELLER_DEBT_REPOSITORY,
      useClass: PrismaMarketplaceSellerDebtRepository,
    },

    // Domain Services
    CommissionCalculatorService,
    SettlementStateMachineService,
    {
      provide: FederatedSearchService,
      useFactory: (productRepo: PrismaFederatedProductRepository) =>
        new FederatedSearchService(productRepo),
      inject: [FEDERATED_PRODUCT_REPOSITORY],
    },

    // Use Cases
    {
      provide: SearchFederatedProductsUseCase,
      useFactory: (
        productRepo: PrismaFederatedProductRepository,
        configRepo: PrismaMarketplaceConfigRepository,
        searchService: FederatedSearchService,
        prisma: PrismaClient,
      ) =>
        new SearchFederatedProductsUseCase(
          productRepo,
          configRepo,
          searchService,
          prisma,
        ),
      inject: [
        FEDERATED_PRODUCT_REPOSITORY,
        MARKETPLACE_CONFIG_REPOSITORY,
        FederatedSearchService,
        PrismaClient,
      ],
    },
    {
      provide: AddCrossStoreItemUseCase,
      useFactory: (
        orderRepo: PrismaCrossStoreOrderRepository,
        configRepo: PrismaMarketplaceConfigRepository,
        productRepo: PrismaFederatedProductRepository,
        commissionCalc: CommissionCalculatorService,
        carts: PrismaMarketplaceCartRepository,
      ) =>
        new AddCrossStoreItemUseCase(
          orderRepo,
          configRepo,
          productRepo,
          commissionCalc,
          carts,
        ),
      inject: [
        CROSS_STORE_ORDER_REPOSITORY,
        MARKETPLACE_CONFIG_REPOSITORY,
        FEDERATED_PRODUCT_REPOSITORY,
        CommissionCalculatorService,
        PrismaMarketplaceCartRepository,
      ],
    },
    {
      provide: PlaceCrossStoreOrderUseCase,
      useFactory: (
        orderRepo: PrismaCrossStoreOrderRepository,
        settlementRepo: PrismaMarketplaceSettlementRepository,
        configRepo: PrismaMarketplaceConfigRepository,
        stateMachine: SettlementStateMachineService,
        financial: PrismaMarketplaceFinancialRepository,
      ) =>
        new PlaceCrossStoreOrderUseCase(
          orderRepo,
          settlementRepo,
          configRepo,
          stateMachine,
          financial,
        ),
      inject: [
        CROSS_STORE_ORDER_REPOSITORY,
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_CONFIG_REPOSITORY,
        SettlementStateMachineService,
        PrismaMarketplaceFinancialRepository,
      ],
    },
    {
      provide: UpdateMarketplaceConfigUseCase,
      useFactory: (configRepo: PrismaMarketplaceConfigRepository) =>
        new UpdateMarketplaceConfigUseCase(configRepo),
      inject: [MARKETPLACE_CONFIG_REPOSITORY],
    },
    {
      provide: SyncMerchantProductsUseCase,
      useFactory: (productRepo: PrismaFederatedProductRepository) =>
        new SyncMerchantProductsUseCase(productRepo),
      inject: [FEDERATED_PRODUCT_REPOSITORY],
    },
    {
      provide: HandleMarketplaceChargebackUseCase,
      useFactory: (
        settlementRepo: PrismaMarketplaceSettlementRepository,
        debtRepo: PrismaMarketplaceSellerDebtRepository,
        stateMachine: SettlementStateMachineService,
        financial: PrismaMarketplaceFinancialRepository,
      ) =>
        new HandleMarketplaceChargebackUseCase(settlementRepo, debtRepo, stateMachine, financial),
      inject: [
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
        SettlementStateMachineService,
        PrismaMarketplaceFinancialRepository,
      ],
    },
    {
      provide: ProcessScheduledTransfersUseCase,
      useFactory: (
        settlementRepo: PrismaMarketplaceSettlementRepository,
        stateMachine: SettlementStateMachineService,
        configRepo: PrismaMarketplaceConfigRepository,
        payouts: ExecuteMarketplacePayoutUseCase,
        payoutRepo: PrismaMarketplacePayoutRepository,
        residuals: ExecuteMarketplaceResidualUseCase,
        residualRepo: PrismaMarketplaceResidualRepository,
      ) =>
        new ProcessScheduledTransfersUseCase(settlementRepo, stateMachine, configRepo, payouts, payoutRepo, residuals, residualRepo),
      inject: [MARKETPLACE_SETTLEMENT_REPOSITORY, SettlementStateMachineService, MARKETPLACE_CONFIG_REPOSITORY, ExecuteMarketplacePayoutUseCase,
        PrismaMarketplacePayoutRepository, ExecuteMarketplaceResidualUseCase, PrismaMarketplaceResidualRepository],
    },
    {
      provide: RegisterMarketplaceReturnUseCase,
      useFactory: (financial: PrismaMarketplaceFinancialRepository) => new RegisterMarketplaceReturnUseCase(financial),
      inject: [PrismaMarketplaceFinancialRepository],
    },
    {
      provide: GetSellerOrdersUseCase,
      useFactory: (orderRepo: PrismaCrossStoreOrderRepository) =>
        new GetSellerOrdersUseCase(orderRepo),
      inject: [CROSS_STORE_ORDER_REPOSITORY],
    },
    {
      provide: GetSellerStatsUseCase,
      useFactory: (
        orderRepo: PrismaCrossStoreOrderRepository,
        settlementRepo: PrismaMarketplaceSettlementRepository,
        debtRepo: PrismaMarketplaceSellerDebtRepository,
      ) =>
        new GetSellerStatsUseCase(orderRepo, settlementRepo, debtRepo),
      inject: [
        CROSS_STORE_ORDER_REPOSITORY,
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
      ],
    },
    {
      provide: UpdateMarketplaceFulfillmentUseCase,
      useFactory: (orderRepo: PrismaCrossStoreOrderRepository) =>
        new UpdateMarketplaceFulfillmentUseCase(orderRepo),
      inject: [CROSS_STORE_ORDER_REPOSITORY],
    },
    {
      provide: ListSellerSettlementsUseCase,
      useFactory: (settlementRepo: PrismaMarketplaceSettlementRepository) =>
        new ListSellerSettlementsUseCase(settlementRepo),
      inject: [MARKETPLACE_SETTLEMENT_REPOSITORY],
    },
    {
      provide: GetSettlementDetailUseCase,
      useFactory: (
        settlementRepo: PrismaMarketplaceSettlementRepository,
        debtRepo: PrismaMarketplaceSellerDebtRepository,
        stateMachine: SettlementStateMachineService,
      ) =>
        new GetSettlementDetailUseCase(settlementRepo, debtRepo, stateMachine),
      inject: [
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
        SettlementStateMachineService,
      ],
    },
    {
      provide: ListSellerDebtsUseCase,
      useFactory: (debtRepo: PrismaMarketplaceSellerDebtRepository) =>
        new ListSellerDebtsUseCase(debtRepo),
      inject: [MARKETPLACE_SELLER_DEBT_REPOSITORY],
    },
    {
      provide: GetDebtDetailUseCase,
      useFactory: (
        debtRepo: PrismaMarketplaceSellerDebtRepository,
        settlementRepo: PrismaMarketplaceSettlementRepository,
      ) =>
        new GetDebtDetailUseCase(debtRepo, settlementRepo),
      inject: [
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
        MARKETPLACE_SETTLEMENT_REPOSITORY,
      ],
    },
    {
      provide: ListMarketplaceChargebacksUseCase,
      useFactory: (
        settlementRepo: PrismaMarketplaceSettlementRepository,
        debtRepo: PrismaMarketplaceSellerDebtRepository,
      ) =>
        new ListMarketplaceChargebacksUseCase(settlementRepo, debtRepo),
      inject: [
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
      ],
    },
    {
      provide: ListMarketplaceEventsUseCase,
      useFactory: (settlementRepo: PrismaMarketplaceSettlementRepository) =>
        new ListMarketplaceEventsUseCase(settlementRepo),
      inject: [MARKETPLACE_SETTLEMENT_REPOSITORY],
    },
    {
      provide: ListPartnerStoresUseCase,
      useFactory: (prisma: PrismaClient) =>
        new ListPartnerStoresUseCase(prisma),
      inject: [PrismaClient],
    },

    // Background Jobs
    SyncMarketplaceIndexJob,
    FundMarketplaceOrdersJob,
    ProcessTransfersJob,
    FinalizeSettlementsJob,

    // Event Handlers (BullMQ: event-driven sync from Catalog → Federated Index)
    MarketplaceCatalogSyncScheduler,
    MarketplaceCatalogSyncWorker,
  ],
  exports: [
    ReconcileMarketplaceNativeRecoveryUseCase,
    PrismaMarketplaceRefundRepository,
    ExecuteMarketplaceRefundUseCase,
    PrismaMarketplaceCartRepository,
    CROSS_STORE_ORDER_REPOSITORY,
    SearchFederatedProductsUseCase,
    AddCrossStoreItemUseCase,
    PlaceCrossStoreOrderUseCase,
    UpdateMarketplaceConfigUseCase,
    SyncMerchantProductsUseCase,
    HandleMarketplaceChargebackUseCase,
    RegisterMarketplaceReturnUseCase,
    ProcessScheduledTransfersUseCase,
    GetSellerOrdersUseCase,
    GetSellerStatsUseCase,
    UpdateMarketplaceFulfillmentUseCase,
    ListSellerSettlementsUseCase,
    GetSettlementDetailUseCase,
    ListSellerDebtsUseCase,
    GetDebtDetailUseCase,
    ListMarketplaceChargebacksUseCase,
    ListMarketplaceEventsUseCase,
    ListPartnerStoresUseCase,
  ],
})
export class MarketplaceModule {}
