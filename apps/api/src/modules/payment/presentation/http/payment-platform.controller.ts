import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  currentTenantPrincipal,
  type TenantPrincipal,
} from "../../../../shared/auth/tenant-principal.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import { paymentConnectReturn } from "../../application/payment-platform/connect/payment-connect-return.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import {
  ApproveAsaasSandboxUseCase,
  CreateAsaasSubaccountUseCase,
  CreateBillingCheckoutUseCase,
  CreateBillingPortalUseCase,
  CreateStripeConnectOnboardingLinkUseCase,
  DeletePaymentConnectionUseCase,
  GetAsaasOnboardingLinkUseCase,
  GetBillingSubscriptionUseCase,
  GetPaymentConnectionsUseCase,
  SaveAsaasConnectionConfigUseCase,
  SyncAsaasSubaccountUseCase,
  SyncStripeConnectUseCase,
} from "../../application/payment-platform.use-cases.js";
import type {
  BillingSubscriptionWithPlanSnapshot,
  PaymentConnectionSnapshot,
} from "../../domain/payment-platform.types.js";
import {
  CreateAsaasSubaccountDto,
  CreateBillingCheckoutDto,
} from "./payment-platform.dto.js";
import { StartTrialUseCase } from "../../application/payment-platform/billing/start-trial.use-case.js";
import { SubscribeToPlanUseCase } from "../../application/payment-platform/billing/subscribe-to-plan.use-case.js";
import { ChangeSubscriptionPlanUseCase } from "../../application/payment-platform/billing/change-subscription-plan.use-case.js";
import { CancelSubscriptionUseCase } from "../../application/payment-platform/billing/cancel-subscription.use-case.js";
import { BILLING_PLANS } from "../../domain/billing-plans.js";
import type { BillingPlan } from "../../domain/payment-platform.types.js";

import { IsString, IsOptional, IsBoolean, ValidateNested, IsIn } from "class-validator";
import { Type } from "class-transformer";

// Plan cards for the onboarding/billing UI, derived from BILLING_PLANS.
const enabledFeatures = (plan: BillingPlan): string[] =>
  Object.entries(BILLING_PLANS[plan].features).filter(([, on]) => on).map(([k]) => k);

const BILLING_PLAN_CARDS = [
  { key: "starter", name: BILLING_PLANS.starter.name, priceBrl: BILLING_PLANS.starter.monthlyPriceBrl, trialDays: 14, badge: "14 dias grátis", recommended: false, ctaLabel: "Começar grátis", features: enabledFeatures("starter") },
  { key: "growth", name: BILLING_PLANS.growth.name, priceBrl: BILLING_PLANS.growth.monthlyPriceBrl, trialDays: 0, badge: null, recommended: true, ctaLabel: "Assinar", features: enabledFeatures("growth") },
  { key: "scale", name: BILLING_PLANS.scale.name, priceBrl: BILLING_PLANS.scale.monthlyPriceBrl, trialDays: 0, badge: null, recommended: false, ctaLabel: "Assinar", features: enabledFeatures("scale") },
];

class BillingCardDto {
  @IsString() holderName!: string;
  @IsString() number!: string;
  @IsString() expiryMonth!: string;
  @IsString() expiryYear!: string;
  @IsString() ccv!: string;
}
class BillingHolderInfoDto {
  @IsString() name!: string;
  @IsString() email!: string;
  @IsString() cpfCnpj!: string;
  @IsString() postalCode!: string;
  @IsString() addressNumber!: string;
  @IsString() phone!: string;
}
class SubscribeToPlanHttpDto {
  @IsIn(["growth", "scale"]) planKey!: "growth" | "scale";
  @ValidateNested() @Type(() => BillingCardDto) card!: BillingCardDto;
  @ValidateNested() @Type(() => BillingHolderInfoDto) holderInfo!: BillingHolderInfoDto;
}
class ChangePlanHttpDto {
  @IsIn(["starter", "growth", "scale"]) targetPlan!: "starter" | "growth" | "scale";
}
class CancelSubscriptionHttpDto {
  @IsOptional() @IsBoolean() immediate?: boolean;
}

class SaveAsaasConfigDto {
  @IsString()
  api_key!: string;

  @IsOptional()
  @IsString()
  webhook_token?: string;

  @IsOptional()
  @IsBoolean()
  sandbox?: boolean;
}

@ApiTags("Payment connections")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({
  humanOnly: true,
  humanRoles: ["owner", "admin"],
})
@Controller("payments/connections")
export class PaymentPlatformController {
  constructor(
    private readonly getConnections: GetPaymentConnectionsUseCase,
    private readonly stripeOnboarding: CreateStripeConnectOnboardingLinkUseCase,
    private readonly syncStripe: SyncStripeConnectUseCase,
    private readonly createAsaas: CreateAsaasSubaccountUseCase,
    private readonly approveAsaasSandbox: ApproveAsaasSandboxUseCase,
    private readonly asaasOnboarding: GetAsaasOnboardingLinkUseCase,
    private readonly syncAsaas: SyncAsaasSubaccountUseCase,
  ) {}

  @ApiOperation({
    summary: "List payment connections",
    description:
      "List active payment provider connections (Stripe, Asaas). Shows status, environment (live/test), account details, and last sync time.",
  })
  @ApiResponse({
    status: 200,
    description: "Payment connections list",
    schema: {
      example: {
        data: [
          {
            id: "merch_123:stripe",
            provider: "stripe",
            account_id: "acct_1234",
            status: "active",
            environment: "live",
          },
        ],
        next_cursor: null,
        has_more: false,
      },
    },
  })
  @Get()
  async list(@Req() request: unknown) {
    return {
      data: (
        await this.getConnections.execute(humanPrincipal(request).tenantId)
      ).map(toConnectionResponse),
      next_cursor: null,
      has_more: false,
    };
  }

  @ApiOperation({
    summary: "Create Stripe Connect onboarding link",
    description:
      "Initiate Stripe Connect onboarding. Returns onboarding URL (expires in 24h) and current connection snapshot. Idempotent.",
  })
  @ApiResponse({
    status: 200,
    description: "Onboarding link created",
    schema: {
      example: {
        url: "https://connect.stripe.com/onboarding/...",
        expires_at: "2026-08-11T00:00:00Z",
        connection: {},
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Not merchant owner/admin",
  })
  @Post("stripe/onboarding-link")
  @Idempotent()
  async createStripeLink(@Req() request: unknown, @Body() body?: { return_to?: unknown }) {
    const principal = humanPrincipal(request);
    const result = await this.stripeOnboarding.execute({
      merchantId: principal.tenantId,
      email: principal.email,
      returnTo: paymentConnectReturn(body?.return_to),
    });
    return {
      url: result.url,
      expires_at: result.expiresAt ?? null,
      connection: toConnectionResponse(result.connection),
    };
  }

  @ApiOperation({
    summary: "Sync Stripe connection status",
    description:
      "Poll Stripe API for latest connection status, account details, requirements, and error codes. Idempotent.",
  })
  @ApiResponse({
    status: 200,
    description: "Connection status synced",
  })
  @ApiResponse({
    status: 403,
    description: "Not merchant owner/admin",
  })
  @Post("stripe/sync")
  @Idempotent()
  async syncStripeConnection(@Req() request: unknown) {
    return toConnectionResponse(
      await this.syncStripe.execute(humanPrincipal(request).tenantId),
    );
  }

  @ApiOperation({
    summary: "Create Asaas subaccount",
    description:
      "Create a new Asaas payment processor subaccount. Requires business details: name, email, CPF/CNPJ, address, and optional bank routing. Idempotent.",
  })
  @ApiResponse({
    status: 200,
    description: "Asaas subaccount created",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid business details",
  })
  @ApiResponse({
    status: 403,
    description: "Not merchant owner/admin",
  })
  @Post("asaas")
  @Idempotent()
  async createAsaasSubaccount(
    @Req() request: unknown,
    @Body() body: CreateAsaasSubaccountDto,
  ) {
    return toConnectionResponse(
      await this.createAsaas.execute(humanPrincipal(request).tenantId, {
        name: body.name,
        email: body.email,
        loginEmail: body.login_email,
        cpfCnpj: body.cpf_cnpj,
        birthDate: body.birth_date,
        companyType: body.company_type,
        phone: body.phone,
        mobilePhone: body.mobile_phone,
        site: body.site,
        incomeValue: body.income_value,
        address: body.address,
        addressNumber: body.address_number,
        complement: body.complement,
        province: body.province,
        postalCode: body.postal_code,
      }),
    );
  }

  @ApiOperation({
    summary: "Get Asaas onboarding link",
    description:
      "Retrieve Asaas subaccount onboarding/dashboard URL. Idempotent.",
  })
  @ApiResponse({
    status: 200,
    description: "Onboarding link retrieved",
    schema: {
      example: {
        url: "https://dashboard.asaas.com/...",
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Not merchant owner/admin",
  })
  @Post("asaas/onboarding-link")
  @Idempotent()
  asaasLink(@Req() request: unknown) {
    return this.asaasOnboarding.execute(
      humanPrincipal(request).tenantId,
    );
  }

  @ApiOperation({
    summary: "Sync Asaas connection status",
    description:
      "Poll Asaas API for latest subaccount details, account status, and settlement info. Idempotent.",
  })
  @ApiResponse({
    status: 200,
    description: "Connection status synced",
  })
  @ApiResponse({
    status: 403,
    description: "Not merchant owner/admin",
  })
  @Post("asaas/sync")
  @Idempotent()
  async syncAsaasConnection(@Req() request: unknown) {
    return toConnectionResponse(
      await this.syncAsaas.execute(humanPrincipal(request).tenantId),
    );
  }

  @ApiOperation({
    summary: "Approve Asaas subaccount in sandbox (dev only)",
    description: "Sandbox-only: instantly approves the subaccount's KYC so BaaS can be tested. Refused in production.",
  })
  @Post("asaas/sandbox-approve")
  @Idempotent()
  async approveAsaasSandboxConnection(@Req() request: unknown) {
    return toConnectionResponse(
      await this.approveAsaasSandbox.execute(humanPrincipal(request).tenantId),
    );
  }
}

@ApiTags("Merchant payment connections")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({
  humanOnly: true,
  humanRoles: ["owner", "admin"],
})
@Controller("merchants/me/payment-connections")
export class MerchantPaymentConnectionsController {
  constructor(
    private readonly getConnections: GetPaymentConnectionsUseCase,
    private readonly stripeOnboarding: CreateStripeConnectOnboardingLinkUseCase,
    private readonly saveAsaas: SaveAsaasConnectionConfigUseCase,
    private readonly deleteConnection: DeletePaymentConnectionUseCase,
  ) {}

  @ApiOperation({
    summary: "List merchant payment connections",
    description:
      "List all payment connections for the current merchant. Returns provider, status, environment, and capabilities.",
  })
  @ApiResponse({
    status: 200,
    description: "Payment connections list",
  })
  @Get()
  async list(@Req() request: unknown) {
    return {
      data: (await this.getConnections.execute(humanPrincipal(request).tenantId)).map(toConnectionResponse),
      next_cursor: null,
      has_more: false,
    };
  }

  @ApiOperation({
    summary: "Save Asaas API key connection",
    description:
      "Store Asaas API key and webhook token for the merchant. Defaults to sandbox mode unless sandbox=false.",
  })
  @ApiResponse({
    status: 200,
    description: "Asaas connection saved",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid API key format",
  })
  @Post("asaas")
  @Idempotent()
  async asaas(@Req() request: unknown, @Body() body: SaveAsaasConfigDto) {
    return toConnectionResponse(
      await this.saveAsaas.execute(humanPrincipal(request).tenantId, {
        apiKey: body.api_key,
        webhookToken: body.webhook_token,
        sandbox: body.sandbox !== false,
      }),
    );
  }

  @ApiOperation({
    summary: "Create Stripe Connect onboarding link",
    description:
      "Initiate Stripe Connect account link for the current merchant. Returns onboarding URL.",
  })
  @ApiResponse({
    status: 200,
    description: "Onboarding link generated",
  })
  @Post("stripe/connect")
  @Idempotent()
  async stripe(@Req() request: unknown) {
    const principal = humanPrincipal(request);
    const result = await this.stripeOnboarding.execute({
      merchantId: principal.tenantId,
      email: principal.email,
    });
    return { url: result.url, expires_at: result.expiresAt ?? null, connection: toConnectionResponse(result.connection) };
  }

  @ApiOperation({
    summary: "Disconnect a payment provider",
    description:
      "Remove a payment provider connection. Provider must be 'stripe' or 'asaas'.",
  })
  @ApiResponse({
    status: 200,
    description: "Connection removed",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid provider name (must be stripe or asaas)",
  })
  @Delete(":provider")
  async disconnect(@Req() request: unknown, @Param("provider") provider: string) {
    if (provider !== "stripe" && provider !== "asaas" && provider !== "mercadopago") throw new BadRequestException("payment_connection_provider_invalid");
    return this.deleteConnection.execute(humanPrincipal(request).tenantId, provider);
  }
}

@ApiTags("Billing")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({
  humanOnly: true,
  humanRoles: ["owner", "admin"],
})
// Active billing routes. The dashboard uses Stripe Checkout and Portal;
// existing Asaas subscription endpoints remain available for legacy accounts.
@Controller("billing")
export class BillingController {
  constructor(
    private readonly getSubscription: GetBillingSubscriptionUseCase,
    private readonly createCheckout: CreateBillingCheckoutUseCase,
    private readonly createPortal: CreateBillingPortalUseCase,
    private readonly startTrial: StartTrialUseCase,
    private readonly subscribeToPlan: SubscribeToPlanUseCase,
    private readonly changePlan: ChangeSubscriptionPlanUseCase,
    private readonly cancelSubscription: CancelSubscriptionUseCase,
  ) {}

  @ApiOperation({ summary: "List billing plans (cards)" })
  @Get("plans")
  listPlans() {
    return BILLING_PLAN_CARDS.map(card => ({
      ...card,
      transactionFeeCents: BILLING_PLANS[card.key as BillingPlan].transactionFeeCents,
      limits: BILLING_PLANS[card.key as BillingPlan].limits,
    }));
  }

  @ApiOperation({ summary: "Start 14-day free trial (Starter)" })
  @Post("subscription/start-trial")
  @Idempotent()
  async startTrialRoute(@Req() request: unknown) {
    const merchantId = humanPrincipal(request).tenantId;
    await this.startTrial.execute(merchantId);
    return toBillingResponse(await this.getSubscription.execute(merchantId));
  }

  @ApiOperation({ summary: "Subscribe to a paid plan (Asaas, credit card)" })
  @Post("subscription")
  @Idempotent()
  async subscribeRoute(@Req() request: unknown, @Body() body: SubscribeToPlanHttpDto) {
    const merchantId = humanPrincipal(request).tenantId;
    await this.subscribeToPlan.execute({
      merchantId,
      planKey: body.planKey,
      card: body.card,
      holderInfo: body.holderInfo,
      remoteIp: (request as { ip?: string }).ip,
    });
    return toBillingResponse(await this.getSubscription.execute(merchantId));
  }

  @ApiOperation({ summary: "Change plan (upgrade immediate / downgrade at period end)" })
  @Post("subscription/change")
  @Idempotent()
  async changePlanRoute(@Req() request: unknown, @Body() body: ChangePlanHttpDto) {
    const merchantId = humanPrincipal(request).tenantId;
    await this.changePlan.execute({ merchantId, targetPlanKey: body.targetPlan });
    return toBillingResponse(await this.getSubscription.execute(merchantId));
  }

  @ApiOperation({ summary: "Cancel subscription (at period end by default)" })
  @Post("subscription/cancel")
  @Idempotent()
  async cancelRoute(@Req() request: unknown, @Body() body: CancelSubscriptionHttpDto) {
    const merchantId = humanPrincipal(request).tenantId;
    await this.cancelSubscription.execute({ merchantId, immediate: body?.immediate });
    return toBillingResponse(await this.getSubscription.execute(merchantId));
  }

  @ApiOperation({
    summary: "Get billing subscription",
    description:
      "Retrieve current billing subscription details including plan, limits, usage counters, trial end date, and Stripe customer status. Plans: free, starter, pro, enterprise.",
  })
  @ApiResponse({
    status: 200,
    description: "Subscription data with plan snapshot and usage",
    schema: {
      example: {
        plan: "pro",
        plan_name: "Pro",
        monthly_price_brl: 9900,
        transaction_fee_percent: 2.5,
        limits: {},
        features: [],
        status: "active",
        trial_end: null,
        usage: {},
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Not merchant owner/admin",
  })
  @Get("subscription")
  async subscription(@Req() request: unknown) {
    return toBillingResponse(
      await this.getSubscription.execute(
        humanPrincipal(request).tenantId,
      ),
    );
  }

  @ApiOperation({
    summary: "Create billing checkout session",
    description:
      "Create a Stripe Checkout session for plan subscription. Requires a plan identifier (plan name or Stripe price_id). Redirects to Stripe hosted checkout. Idempotent.",
  })
  @ApiResponse({
    status: 200,
    description: "Checkout session URL",
    schema: {
      example: {
        url: "https://checkout.stripe.com/...",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Missing or invalid plan/price_id",
  })
  @ApiResponse({
    status: 403,
    description: "Not merchant owner/admin",
  })
  @Post("checkout-session")
  @Idempotent()
  checkout(
    @Req() request: unknown,
    @Body() body: CreateBillingCheckoutDto,
  ) {
    const principal = humanPrincipal(request);
    const plan = body.plan ?? body.price_id;
    if (!plan) throw new BadRequestException("billing_plan_required");
    return this.createCheckout.execute({
      merchantId: principal.tenantId,
      email: principal.email,
      plan,
    });
  }

  @ApiOperation({
    summary: "Create billing portal session",
    description:
      "Create a Stripe Billing Portal session for subscription management (upgrade, downgrade, cancel, payment method updates). Idempotent.",
  })
  @ApiResponse({
    status: 200,
    description: "Portal session URL",
    schema: {
      example: {
        url: "https://billing.stripe.com/...",
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Not merchant owner/admin",
  })
  @Post("portal-session")
  @Idempotent()
  portal(@Req() request: unknown) {
    return this.createPortal.execute(
      humanPrincipal(request).tenantId,
    );
  }
}

function humanPrincipal(
  request: unknown,
): Extract<TenantPrincipal, { kind: "human" }> {
  const principal = currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  );
  if (principal.kind !== "human") {
    throw new Error("human_principal_expected");
  }
  return principal;
}

export function toConnectionResponse(connection: PaymentConnectionSnapshot) {
  return {
    id: `${connection.merchantId}:${connection.provider}`,
    provider: connection.provider,
    account_id: connection.externalAccountId ?? null,
    status: connection.status === "degraded" ? "error" : connection.status,
    environment: connection.environment,
    external_account_id: connection.externalAccountId ?? null,
    wallet_id: connection.walletId ?? null,
    charges_enabled: connection.chargesEnabled,
    payouts_enabled: connection.payoutsEnabled,
    requirements: connection.requirements,
    last_synced_at: connection.lastSyncedAt ?? null,
    last_error_code: connection.lastErrorCode ?? null,
    created_at: connection.createdAt,
    updated_at: connection.updatedAt,
  };
}

function toBillingResponse(subscription: BillingSubscriptionWithPlanSnapshot) {
  return {
    plan: subscription.plan,
    plan_name: subscription.planName,
    monthly_price_brl: subscription.monthlyPriceBrl,
    transaction_fee_cents: subscription.transactionFeeCents,
    buyer_service_fee_cents: subscription.buyerServiceFeeCents,
    limits: subscription.limits,
    features: subscription.features,
    status: subscription.status,
    trial_end: subscription.trialEndsAt ?? null,
    trial_expired: subscription.trialExpired,
    trial_days_remaining: subscription.trialDaysRemaining,
    billing_provider: subscription.provider ?? "stripe",
    trial_ends_at: subscription.trialEndsAt ?? null,
    current_period_end: subscription.currentPeriodEnd ?? null,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    has_billing_customer: Boolean(subscription.stripeCustomerId),
    has_subscription: Boolean(subscription.stripeSubscriptionId),
    usage: subscription.usage ? {
      period_start: subscription.usage.periodStart,
      orders_current: subscription.usage.ordersPerMonth,
      orders_limit: subscription.limits.ordersPerMonth ?? null,
      sessions_current: subscription.usage.sessionsPerMonth,
      sessions_limit: subscription.limits.sessionsPerMonth ?? null,
      ai_conversations_current: subscription.usage.aiConversationsPerMonth,
      ai_conversations_limit: subscription.limits.aiConversationsPerMonth ?? null,
      commerce_connections_current: subscription.usage.commerceConnections,
      commerce_connections_limit: subscription.limits.commerceConnections ?? null,
      webhook_endpoints_current: subscription.usage.webhookEndpoints,
      webhook_endpoints_limit: subscription.limits.webhookEndpoints ?? null,
      team_members_current: subscription.usage.teamMembers,
      team_members_limit: subscription.limits.teamMembers ?? null,
      cross_sell_promotions_current: subscription.usage.crossSellPromotions,
      cross_sell_promotions_limit: subscription.limits.crossSellPromotions ?? null,
      active_coupons_current: subscription.usage.activeCoupons,
      active_coupons_limit: subscription.limits.activeCoupons ?? null,
    } : undefined,
    created_at: subscription.createdAt,
    updated_at: subscription.updatedAt,
  };
}
