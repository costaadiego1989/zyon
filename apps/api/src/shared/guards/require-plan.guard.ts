import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { currentTenantPrincipal } from "../auth/tenant-principal.js";
import {
  REQUIRE_PLAN_METADATA,
  type MerchantPlan,
} from "./require-plan.decorator.js";

const logger = new Logger("RequirePlanGuard");

/**
 * Feature flag guard: validates that a merchant's plan allows access to this endpoint.
 *
 * Usage:
 *   @UseGuards(RequirePlanGuard)
 *   @RequirePlan('STORE_ONLY', 'BOTH')
 *   @Get()
 *   storeCatalog() { ... }
 */
@Injectable()
export class RequirePlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlans = this.reflector.getAllAndOverride<MerchantPlan[]>(
      REQUIRE_PLAN_METADATA,
      [context.getHandler(), context.getClass()],
    );

    // No decorator means plan check is not required
    if (!requiredPlans?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const principal = currentTenantPrincipal(request);
    const merchantId = principal.tenantId;

    // Fetch merchant plan from database
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, plan: true },
    });

    if (!merchant) {
      logger.warn(`Merchant ${merchantId} not found during plan check`);
      throw new ForbiddenException("merchant_not_found");
    }

    // BOTH plan allows access to everything
    if (merchant.plan === "BOTH") {
      return true;
    }

    // Check if merchant's plan is in the allowed set
    if (!requiredPlans.includes(merchant.plan)) {
      logger.debug(
        `Merchant ${merchantId} plan ${merchant.plan} not in allowed plans [${requiredPlans.join(", ")}]`,
      );
      throw new ForbiddenException("plan_not_allowed");
    }

    return true;
  }
}
