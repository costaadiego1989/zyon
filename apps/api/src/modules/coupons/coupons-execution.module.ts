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
import { NORMAL_CHECKOUT_COUPON_READER, type NormalCheckoutCouponReader } from "./domain/ports/normal-checkout-coupon-reader.port.js";
import type { Prisma } from "@prisma/client";
import { readNormalCheckoutCrossSellAuthority } from "../cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.js";
import { projectNormalCrossSellCart } from "../cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.js";
import { toCheckoutSession } from "../checkout/domain/services/checkout-session-projection.js";

/** Coupon execution without HTTP/auth module cycles. All callers share the
 * same transactional validity, reservation and economic authorization path. */
@Module({
  providers: [
    { provide: COUPON_REPOSITORY, useFactory: (prisma: PrismaClient) => new PrismaCouponRepository(prisma), inject: [PRISMA_CLIENT] },
    { provide: COUPON_TRANSACTION_REPOSITORY, useFactory: (prisma: PrismaClient) => new PrismaCouponTransactionRepository(prisma), inject: [PRISMA_CLIENT] },
    RulesEngineDiscountAdapter,
    { provide: DISCOUNT_RULES_ENGINE, useExisting: RulesEngineDiscountAdapter },
    { provide:NORMAL_CHECKOUT_COUPON_READER,useFactory:():NormalCheckoutCouponReader<Prisma.TransactionClient>=>async(tx,scope)=>{
      const current=await readNormalCheckoutCrossSellAuthority(tx,scope);
      return toCheckoutSession({...current.stored,cart:projectNormalCrossSellCart(current)});
    }},
    ApplyCouponUseCase,
  ],
  exports: [COUPON_REPOSITORY, COUPON_TRANSACTION_REPOSITORY, DISCOUNT_RULES_ENGINE, ApplyCouponUseCase],
})
export class CouponsExecutionModule {}
