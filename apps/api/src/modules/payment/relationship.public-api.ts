import { Inject, Injectable, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BillingPlanMeteringService } from "./infrastructure/billing/billing-plan-guard.js";
export { BillingPlanMeteringService };
@Injectable()
export class PaymentRelationshipReader {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: PrismaClient) {}
  async pending(merchantId: string, sessionId: string) {
    return Boolean(
      await this.db.paymentIntent.findFirst({
        where: {
          merchantId,
          sessionId,
          status: { in: ["pending", "processing", "requires_action"] },
        },
        select: { id: true },
      })
    );
  }
}
@Module({
  providers: [BillingPlanMeteringService, PaymentRelationshipReader],
  exports: [BillingPlanMeteringService, PaymentRelationshipReader],
})
export class PaymentRelationshipModule {}
