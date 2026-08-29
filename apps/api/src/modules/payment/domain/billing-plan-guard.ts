import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PrismaClient } from "@prisma/client";
import { currentTenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import {
  BILLING_PLANS,
  effectiveBillingPlan,
  type BillingPlanFeatureKey,
  type BillingPlanLimitKey,
} from "./billing-plans.js";
import type { BillingPlan, BillingSubscriptionSnapshot } from "./payment-platform.types.js";

export type BillingUsageSnapshot = {
  periodStart: string;
  ordersPerMonth: number;
  sessionsPerMonth: number;
  aiConversationsPerMonth: number;
  commerceConnections: number;
  webhookEndpoints: number;
  teamMembers: number;
  crossSellPromotions: number;
  activeCoupons: number;
};

export type PlanLimitRequirement =
  | { kind: "limit"; key: BillingPlanLimitKey; increment?: number; soft?: boolean }
  | { kind: "feature"; key: BillingPlanFeatureKey };

export const PLAN_LIMIT_REQUIREMENT = Symbol("PLAN_LIMIT_REQUIREMENT");

export function RequirePlanLimit(
  key: BillingPlanLimitKey,
  increment = 1,
  opts?: { soft?: boolean },
): ReturnType<typeof SetMetadata> {
  return SetMetadata(PLAN_LIMIT_REQUIREMENT, { kind: "limit", key, increment, soft: opts?.soft } satisfies PlanLimitRequirement);
}

export function RequirePlanFeature(
  key: BillingPlanFeatureKey,
): ReturnType<typeof SetMetadata> {
  return SetMetadata(PLAN_LIMIT_REQUIREMENT, { kind: "feature", key } satisfies PlanLimitRequirement);
}

@Injectable()
export class BillingPlanMeteringService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getSubscription(merchantId: string): Promise<BillingSubscriptionSnapshot | undefined> {
    const row = await this.prisma.merchantBillingSubscription.findUnique({
      where: { merchantId: merchantId.trim() },
    });
    if (!row) return undefined;
    return {
      merchantId: row.merchantId,
      stripeCustomerId: row.stripeCustomerId ?? undefined,
      stripeSubscriptionId: row.stripeSubscriptionId ?? undefined,
      stripePriceId: row.stripePriceId ?? undefined,
      status: toBillingStatus(row.status),
      trialEndsAt: row.trialEndsAt?.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd?.toISOString(),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getEffectivePlan(merchantId: string, now = new Date()): Promise<BillingPlan> {
    return effectiveBillingPlan(await this.getSubscription(merchantId), now);
  }

  async getUsage(merchantId: string, now = new Date()): Promise<BillingUsageSnapshot> {
    const scopedMerchantId = merchantId.trim();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [orders, sessions, connections, endpoints, members, promos, coupons, chatSessions] = await Promise.all([
      this.prisma.completedOrder.count({
        where: {
          merchantId: scopedMerchantId,
          status: "approved",
          completedAt: { gte: periodStart },
        },
      }),
      this.prisma.checkoutSession.count({
        where: { merchantId: scopedMerchantId, createdAt: { gte: periodStart } },
      }),
      this.prisma.merchantCommerceConnection.count({
        where: { merchantId: scopedMerchantId, status: { not: "disconnected" } },
      }),
      this.prisma.merchantWebhookEndpoint.count({
        where: { merchantId: scopedMerchantId },
      }),
      this.prisma.merchantUser.count({
        where: { merchantId: scopedMerchantId },
      }),
      this.prisma.crossSellPromotion.count({
        where: { merchantId: scopedMerchantId, status: "active" },
      }),
      this.prisma.coupon.count({
        where: { merchantId: scopedMerchantId, status: "active" },
      }),
      this.prisma.checkoutSession.findMany({
        where: { merchantId: scopedMerchantId, createdAt: { gte: periodStart } },
        select: { chatHistory: true },
      }),
    ]);

    return {
      periodStart: periodStart.toISOString(),
      ordersPerMonth: orders,
      sessionsPerMonth: sessions,
      aiConversationsPerMonth: chatSessions.reduce((sum, session) => {
        const turns = Array.isArray(session.chatHistory) ? session.chatHistory : [];
        return sum + (turns.some((turn) => isAgentTurn(turn)) ? 1 : 0);
      }, 0),
      commerceConnections: connections,
      webhookEndpoints: endpoints,
      teamMembers: members,
      crossSellPromotions: promos,
      activeCoupons: coupons,
    };
  }

  async assertAllowed(merchantId: string, requirement: PlanLimitRequirement): Promise<void> {
    // In development mode, bypass plan limits entirely
    if (process.env.NODE_ENV === "development" && process.env.BILLING_BYPASS === "true") {
      return;
    }
    const plan = await this.getEffectivePlan(merchantId);
    const config = BILLING_PLANS[plan];
    if (requirement.kind === "feature") {
      if (!config.features[requirement.key]) {
        throw new ForbiddenException({
          code: "plan_feature_unavailable",
          feature: requirement.key,
          plan,
          required_plan: requiredPlanForFeature(requirement.key),
        });
      }
      return;
    }

    const limit = config.limits[requirement.key];
    if (limit === null) return;
    const usage = await this.getUsage(merchantId);
    const current = usage[requirement.key];
    const next = current + (requirement.increment ?? 1);
    if (next > limit) {
      // Soft-limit: aviso, não bloqueia. Starter pode continuar vendendo além do limite.
      if (requirement.soft) {
        console.warn(
          `Plan limit soft-exceeded: merchant=${merchantId}, plan=${plan}, ` +
          `limit=${requirement.key}, current=${current}, attempted=${next}, limit=${limit}`
        );
        return;
      }
      // Hard-limit: bloqueia (default para features não-Starter).
      throw new ForbiddenException({
        code: "plan_limit_exceeded",
        feature: requirement.key,
        plan,
        current,
        attempted: next,
        limit,
        required_plan: requiredPlanForLimit(requirement.key, next),
      });
    }
  }
}

@Injectable()
export class PlanLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly metering: BillingPlanMeteringService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PlanLimitRequirement>(PLAN_LIMIT_REQUIREMENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;
    const request = context.switchToHttp().getRequest<{ body?: unknown; tenantPrincipal?: unknown; user?: unknown }>();
    const merchantId = resolveMerchantId(request);
    await this.metering.assertAllowed(merchantId, requirement);
    return true;
  }
}

function resolveMerchantId(request: { body?: unknown; tenantPrincipal?: unknown; user?: unknown }): string {
  try {
    const principal = currentTenantPrincipal(request as Parameters<typeof currentTenantPrincipal>[0]);
    if (principal.tenantId?.trim()) return principal.tenantId.trim();
  } catch {
    // AuthGuard routes expose req.user; public checkout routes carry merchant_id in body.
  }
  const user = request.user as { merchantId?: unknown } | undefined;
  if (typeof user?.merchantId === "string" && user.merchantId.trim()) return user.merchantId.trim();
  const body = request.body as { merchant_id?: unknown; merchantId?: unknown } | undefined;
  const candidate = typeof body?.merchant_id === "string" ? body.merchant_id : typeof body?.merchantId === "string" ? body.merchantId : "";
  if (!candidate.trim()) throw new ForbiddenException({ code: "plan_limit_scope_missing" });
  return candidate.trim();
}

function toBillingStatus(status: string): BillingSubscriptionSnapshot["status"] {
  if (
    status === "trialing" ||
    status === "starter" ||
    status === "active" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "paused" ||
    status === "cancelled" ||
    status === "incomplete"
  ) return status;
  return status === "canceled" ? "cancelled" : "trialing";
}

function isAgentTurn(turn: unknown): boolean {
  return Boolean(turn && typeof turn === "object" && (turn as { role?: unknown }).role === "agent");
}

function requiredPlanForFeature(feature: BillingPlanFeatureKey): BillingPlan {
  for (const plan of ["starter", "growth", "scale"] as BillingPlan[]) {
    if (BILLING_PLANS[plan].features[feature]) return plan;
  }
  return "scale";
}

function requiredPlanForLimit(limitKey: BillingPlanLimitKey, attempted: number): BillingPlan {
  for (const plan of ["starter", "growth", "scale"] as BillingPlan[]) {
    const limit = BILLING_PLANS[plan].limits[limitKey];
    if (limit === null || attempted <= limit) return plan;
  }
  return "scale";
}
