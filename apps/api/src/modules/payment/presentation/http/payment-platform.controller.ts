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
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  currentTenantPrincipal,
  type TenantPrincipal,
} from "../../../../shared/auth/tenant-principal.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import {
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

class SaveAsaasConfigDto {
  api_key!: string;
  webhook_token?: string;
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
    private readonly asaasOnboarding: GetAsaasOnboardingLinkUseCase,
    private readonly syncAsaas: SyncAsaasSubaccountUseCase,
  ) {}

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

  @Post("stripe/onboarding-link")
  @Idempotent()
  async createStripeLink(@Req() request: unknown) {
    const principal = humanPrincipal(request);
    const result = await this.stripeOnboarding.execute({
      merchantId: principal.tenantId,
      email: principal.email,
    });
    return {
      url: result.url,
      expires_at: result.expiresAt ?? null,
      connection: toConnectionResponse(result.connection),
    };
  }

  @Post("stripe/sync")
  @Idempotent()
  async syncStripeConnection(@Req() request: unknown) {
    return toConnectionResponse(
      await this.syncStripe.execute(humanPrincipal(request).tenantId),
    );
  }

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

  @Post("asaas/onboarding-link")
  @Idempotent()
  asaasLink(@Req() request: unknown) {
    return this.asaasOnboarding.execute(
      humanPrincipal(request).tenantId,
    );
  }

  @Post("asaas/sync")
  @Idempotent()
  async syncAsaasConnection(@Req() request: unknown) {
    return toConnectionResponse(
      await this.syncAsaas.execute(humanPrincipal(request).tenantId),
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

  @Get()
  async list(@Req() request: unknown) {
    return {
      data: (await this.getConnections.execute(humanPrincipal(request).tenantId)).map(toConnectionResponse),
      next_cursor: null,
      has_more: false,
    };
  }

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

  @Delete(":provider")
  async disconnect(@Req() request: unknown, @Param("provider") provider: string) {
    if (provider !== "stripe" && provider !== "asaas") throw new BadRequestException("payment_connection_provider_invalid");
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
@Controller("billing")
export class BillingController {
  constructor(
    private readonly getSubscription: GetBillingSubscriptionUseCase,
    private readonly createCheckout: CreateBillingCheckoutUseCase,
    private readonly createPortal: CreateBillingPortalUseCase,
  ) {}

  @Get("subscription")
  async subscription(@Req() request: unknown) {
    return toBillingResponse(
      await this.getSubscription.execute(
        humanPrincipal(request).tenantId,
      ),
    );
  }

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

function toConnectionResponse(connection: PaymentConnectionSnapshot) {
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
    transaction_fee_percent: subscription.transactionFeePercent,
    limits: subscription.limits,
    features: subscription.features,
    status: subscription.status,
    trial_end: subscription.trialEndsAt ?? null,
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
