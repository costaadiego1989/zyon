import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { DashboardController } from "./presentation/http/dashboard.controller.js";
import { FinanceDashboardController } from "./presentation/http/finance-dashboard.controller.js";
import { GetNavCountsUseCase } from "./application/get-nav-counts.use-case.js";
import { MarkBadgeViewedUseCase } from "./application/mark-badge-viewed.use-case.js";
import { FinanceDashboardUseCase } from "./application/finance-dashboard.use-case.js";
import { PaymentModule } from "../payment/payment.module.js";
import { PAYMENT_SETTLEMENT_LEDGER, type PaymentSettlementLedgerPort } from "../payment/domain/ports/payment-settlement-ledger.port.js";
import { GetPaymentAllocationHistoryUseCase } from "./application/get-payment-allocation-history.use-case.js";

/**
 * DashboardModule — dashboard-specific read endpoints (nav badge counts, etc).
 * PRISMA_CLIENT and AuthGuard are provided by @Global() modules.
 */
@Module({
  imports: [PaymentModule],
  controllers: [DashboardController, FinanceDashboardController],
  providers: [
    {
      provide: GetNavCountsUseCase,
      useFactory: (prisma: PrismaClient) => new GetNavCountsUseCase(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: MarkBadgeViewedUseCase,
      useFactory: (prisma: PrismaClient) => new MarkBadgeViewedUseCase(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: FinanceDashboardUseCase,
      useFactory: (prisma: PrismaClient) => new FinanceDashboardUseCase(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: GetPaymentAllocationHistoryUseCase,
      useFactory: (ledger: PaymentSettlementLedgerPort) => new GetPaymentAllocationHistoryUseCase(ledger),
      inject: [PAYMENT_SETTLEMENT_LEDGER],
    },
  ],
})
export class DashboardModule {}
