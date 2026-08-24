import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";
import { currentTenantPrincipal } from "../auth/tenant-principal.js";
import {
  REQUIRE_PLAN_METADATA,
  type MerchantPlan,
} from "./require-plan.decorator.js";

const logger = new Logger("RequirePlanGuard");

@Injectable()
export class RequirePlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlans = this.reflector.getAllAndOverride<MerchantPlan[]>(
      REQUIRE_PLAN_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPlans?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const principal = currentTenantPrincipal(request);
    const merchantId = principal.tenantId;

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, plan: true },
    });

    if (!merchant) {
      logger.warn(`Merchant ${merchantId} not found during plan check`);
      throw new ForbiddenException("merchant_not_found");
    }

    if (merchant.plan === "BOTH") {
      return true;
    }

    // Legacy CHECKOUT_ONLY merchants are treated as BOTH (full platform)
    const effectivePlan = merchant.plan === "CHECKOUT_ONLY" ? "BOTH" : merchant.plan;

    if (!requiredPlans.includes(effectivePlan as MerchantPlan)) {
      logger.debug(
        `Merchant ${merchantId} plan ${merchant.plan} not in allowed plans [${requiredPlans.join(", ")}]`,
      );
      throw new ForbiddenException("plan_not_allowed");
    }

    return true;
  }
}
