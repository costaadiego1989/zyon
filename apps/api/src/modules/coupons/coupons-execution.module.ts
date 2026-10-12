import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { ApplyCouponUseCase } from "./application/use-cases/apply-coupon.use-case.js";
import { COUPON_REPOSITORY } from "./domain/ports/coupon-repository.port.js";
import { COUPON_TRANSACTION_REPOSITORY } from "./domain/ports/coupon-transaction-repository.port.js";
import { DISCOUNT_RULES_ENGINE } from "./domain/ports/discount-rules-engine.port.js";
import { RulesEngineDiscountAdapter } from "./infrastructure/adapters/rules-engine-discount.adapter.js";
import { PrismaCouponRepository } from "./infrastructure/repositories/prisma-coupon.repository.js";
import { PrismaCouponTransactionRepository } from "./infrastructure/repositories/prisma-coupon-transaction.repository.js";

/** Coupon execution without HTTP/auth module cycles. All callers share the
 * same transactional validity, reservation and economic authorization path. */
@Module({
  providers: [
    { provide: COUPON_REPOSITORY, useFactory: (prisma: PrismaClient) => new PrismaCouponRepository(prisma), inject: [PRISMA_CLIENT] },
    { provide: COUPON_TRANSACTION_REPOSITORY, useFactory: (prisma: PrismaClient) => new PrismaCouponTransactionRepository(prisma), inject: [PRISMA_CLIENT] },
    RulesEngineDiscountAdapter,
    { provide: DISCOUNT_RULES_ENGINE, useExisting: RulesEngineDiscountAdapter },
    ApplyCouponUseCase,
  ],
  exports: [COUPON_REPOSITORY, COUPON_TRANSACTION_REPOSITORY, DISCOUNT_RULES_ENGINE, ApplyCouponUseCase],
})
export class CouponsExecutionModule {}
