import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../merchant/domain/ports/merchant-repository.port.js";
import {
  ASAAS_PLATFORM_PORT,
  BILLING_CONFIG_PORT,
  PAYMENT_PLATFORM_ENVIRONMENT,
  STRIPE_PLATFORM_PORT,
  type AsaasPlatformPort,
  type BillingConfigPort,
  type PaymentPlatformEnvironment,
  type StripePlatformPort,
} from "../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../domain/ports/payment-platform-repository.port.js";
import type {
  AsaasSubaccountInput,
  BillingPlan,
  BillingSubscriptionSnapshot,
  BillingSubscriptionWithPlanSnapshot,
  PaymentConnectionSnapshot,
} from "../domain/payment-platform.types.js";
import { BILLING_PLANS, effectiveBillingPlan } from "../domain/billing-plans.js";
import { BillingPlanMeteringService } from "../domain/billing-plan-guard.js";

@Injectable()
export class GetPaymentConnectionsUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  execute(merchantId: string): Promise<PaymentConnectionSnapshot[]> {
    return this.repository.listConnections(merchantId);
  }
}

@Injectable()
export class SaveAsaasConnectionConfigUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(PAYMENT_PLATFORM_ENVIRONMENT)
    private readonly environment: PaymentPlatformEnvironment,
  ) {}

  async execute(
    merchantId: string,
    input: { apiKey: string; webhookToken?: string; sandbox: boolean },
  ): Promise<PaymentConnectionSnapshot> {
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new BadRequestException("asaas_api_key_required");
    await this.repository.saveConnection({
      merchantId,
      provider: "asaas",
      environment: input.sandbox ? "test" : this.environment.asaas,
      status: "active",
      externalAccountId: "manual",
      secret: JSON.stringify({ apiKey, webhookToken: input.webhookToken?.trim() ?? "" }),
      chargesEnabled: true,
      payoutsEnabled: true,
      requirements: [],
      syncedAt: new Date().toISOString(),
    });
    return requiredConnection(this.repository, merchantId, "asaas");
  }
}

@Injectable()
export class DeletePaymentConnectionUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(merchantId: string, provider: "stripe" | "asaas"): Promise<{ success: boolean }> {
    await this.repository.deleteConnection(merchantId, provider);
    return { success: true };
  }
}

@Injectable()
export class CreateStripeConnectOnboardingLinkUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(PAYMENT_PLATFORM_ENVIRONMENT)
    private readonly environment: PaymentPlatformEnvironment,
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
    @Inject(BILLING_CONFIG_PORT)
    private readonly billingConfig: BillingConfigPort,
  ) {}

  async execute(input: {
    merchantId: string;
    email: string;
  }): Promise<{
    url: string;
    expiresAt?: string;
    connection: PaymentConnectionSnapshot;
  }> {
    const profile = await this.merchants.getProfile(input.merchantId);
    if (!profile) throw new NotFoundException("merchant_not_found");

    let connection = await this.repository.getConnection(
      input.merchantId,
      "stripe",
    );
    let accountId = connection?.externalAccountId;
    if (!accountId) {
      const created = await this.stripe.createConnectAccount({
        merchantId: input.merchantId,
        merchantName: profile.name,
        email: input.email,
      });
      accountId = created.accountId;
      await this.repository.saveConnection({
        merchantId: input.merchantId,
        provider: "stripe",
        environment: this.environment.stripe,
        status: "pending",
        externalAccountId: accountId,
      });
      await this.merchants.setStripeConnectAccountId(
        input.merchantId,
        accountId,
      );
      connection = await requiredConnection(
        this.repository,
        input.merchantId,
        "stripe",
      );
    }

    const consoleUrl = this.billingConfig.consoleUrl();
    const link = await this.stripe.createConnectOnboardingLink({
      accountId,
      refreshUrl: `${consoleUrl}/settings/payments/stripe/refresh`,
      returnUrl: `${consoleUrl}/settings/payments/stripe/return`,
    });
    return {
      ...link,
      connection: await requiredConnection(
        this.repository,
        input.merchantId,
        "stripe",
      ),
    };
  }
}

@Injectable()
export class SyncStripeConnectUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(PAYMENT_PLATFORM_ENVIRONMENT)
    private readonly environment: PaymentPlatformEnvironment,
  ) {}

  async execute(merchantId: string): Promise<PaymentConnectionSnapshot> {
    const connection = await requiredConnection(
      this.repository,
      merchantId,
      "stripe",
    );
    if (!connection.externalAccountId) {
      throw new ConflictException("stripe_connect_account_missing");
    }
    try {
      const status = await this.stripe.retrieveConnectAccount(
        connection.externalAccountId,
      );
      const active =
        status.chargesEnabled &&
        status.payoutsEnabled &&
        status.detailsSubmitted &&
        status.requirements.length === 0;
      await this.repository.saveConnection({
        merchantId,
        provider: "stripe",
        environment: this.environment.stripe,
        status: active ? "active" : "restricted",
        externalAccountId: status.accountId,
        chargesEnabled: status.chargesEnabled,
        payoutsEnabled: status.payoutsEnabled,
        requirements: status.requirements,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.repository.saveConnection({
        merchantId,
        provider: "stripe",
        environment: connection.environment,
        status: "degraded",
        externalAccountId: connection.externalAccountId,
        errorCode: providerErrorCode(error),
      });
      throw providerGatewayError("stripe", error);
    }
    return requiredConnection(this.repository, merchantId, "stripe");
  }
}

@Injectable()
export class CreateAsaasSubaccountUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(ASAAS_PLATFORM_PORT)
    private readonly asaas: AsaasPlatformPort,
    @Inject(PAYMENT_PLATFORM_ENVIRONMENT)
    private readonly environment: PaymentPlatformEnvironment,
  ) {}

  async execute(
    merchantId: string,
    input: AsaasSubaccountInput,
  ): Promise<PaymentConnectionSnapshot> {
    const existing = await this.repository.getConnection(
      merchantId,
      "asaas",
    );
    if (existing) {
      throw new ConflictException("asaas_subaccount_already_exists");
    }
    try {
      const created = await this.asaas.createSubaccount(input);
      await this.repository.saveConnection({
        merchantId,
        provider: "asaas",
        environment: this.environment.asaas,
        status: "pending",
        externalAccountId: created.accountId,
        walletId: created.walletId,
        secret: created.apiKey,
        requirements: ["documentation"],
      });
      return requiredConnection(this.repository, merchantId, "asaas");
    } catch (error) {
      throw providerGatewayError("asaas", error);
    }
  }
}

@Injectable()
export class GetAsaasOnboardingLinkUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(ASAAS_PLATFORM_PORT)
    private readonly asaas: AsaasPlatformPort,
  ) {}

  async execute(merchantId: string): Promise<{ url: string }> {
    const connection = await requiredConnection(
      this.repository,
      merchantId,
      "asaas",
    );
    const elapsed = Date.now() - new Date(connection.createdAt).getTime();
    if (elapsed < 15_000) {
      throw new ConflictException({
        code: "asaas_documents_not_ready",
        detail:
          "Asaas requires at least 15 seconds before document discovery.",
        retry_after_seconds: Math.ceil((15_000 - elapsed) / 1000),
      });
    }
    const apiKey = await requiredAsaasSecret(
      this.repository,
      merchantId,
    );
    const links = await this.asaas.listOnboardingLinks(apiKey);
    if (links.length === 0) {
      throw new ConflictException("asaas_onboarding_link_not_available");
    }
    return { url: links[0]! };
  }
}

@Injectable()
export class SyncAsaasSubaccountUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(ASAAS_PLATFORM_PORT)
    private readonly asaas: AsaasPlatformPort,
  ) {}

  async execute(merchantId: string): Promise<PaymentConnectionSnapshot> {
    const connection = await requiredConnection(
      this.repository,
      merchantId,
      "asaas",
    );
    const apiKey = await requiredAsaasSecret(
      this.repository,
      merchantId,
    );
    try {
      const provider = await this.asaas.retrieveAccountStatus(apiKey);
      const requirements = [
        ["commercial_info", provider.commercialInfo],
        ["bank_account_info", provider.bankAccountInfo],
        ["documentation", provider.documentation],
      ]
        .filter(([, status]) => status !== "APPROVED")
        .map(([name, status]) => `${name}:${status.toLowerCase()}`);
      await this.repository.saveConnection({
        merchantId,
        provider: "asaas",
        environment: connection.environment,
        status:
          provider.general === "APPROVED" ? "active" : "restricted",
        externalAccountId: connection.externalAccountId,
        walletId: connection.walletId,
        chargesEnabled: provider.general === "APPROVED",
        payoutsEnabled: provider.general === "APPROVED",
        requirements,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.repository.saveConnection({
        merchantId,
        provider: "asaas",
        environment: connection.environment,
        status: "degraded",
        externalAccountId: connection.externalAccountId,
        walletId: connection.walletId,
        errorCode: providerErrorCode(error),
      });
      throw providerGatewayError("asaas", error);
    }
    return requiredConnection(this.repository, merchantId, "asaas");
  }
}

@Injectable()
export class GetBillingSubscriptionUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    private readonly metering?: BillingPlanMeteringService,
  ) {}

  async execute(merchantId: string): Promise<BillingSubscriptionWithPlanSnapshot> {
    const subscription = await this.repository.getOrCreateTrial(merchantId, 14);
    const plan = effectiveBillingPlan(subscription);
    const config = BILLING_PLANS[plan];
    const usage = await this.metering?.getUsage(merchantId);
    return {
      ...subscription,
      plan,
      planName: config.name,
      monthlyPriceBrl: config.monthlyPriceBrl,
      transactionFeePercent: subscription.status === "trialing"
        ? BILLING_PLANS.starter.transactionFeePercent
        : config.transactionFeePercent,
      limits: config.limits,
      features: config.features,
      usage,
    };
  }
}

@Injectable()
export class CreateBillingCheckoutUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
    @Inject(BILLING_CONFIG_PORT)
    private readonly billingConfig: BillingConfigPort,
  ) {}

  async execute(input: {
    merchantId: string;
    email: string;
    plan: BillingPlan;
  }): Promise<{ url: string; sessionId: string }> {
    const profile = await this.merchants.getProfile(input.merchantId);
    if (!profile) throw new NotFoundException("merchant_not_found");
    const billing = await this.repository.getOrCreateTrial(
      input.merchantId,
      14,
    );
    let customerId = billing.stripeCustomerId;
    if (!customerId) {
      customerId = (
        await this.stripe.createBillingCustomer({
          merchantId: input.merchantId,
          merchantName: profile.name,
          email: input.email,
        })
      ).customerId;
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        stripeCustomerId: customerId,
      });
    }
    const priceId = this.billingConfig.priceId(input.plan);
    const consoleUrl = this.billingConfig.consoleUrl();
    return this.stripe.createSubscriptionCheckout({
      merchantId: input.merchantId,
      customerId,
      priceId,
      successUrl: `${consoleUrl}/settings/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${consoleUrl}/settings/billing`,
    });
  }
}

@Injectable()
export class CreateBillingPortalUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(BILLING_CONFIG_PORT)
    private readonly billingConfig: BillingConfigPort,
  ) {}

  async execute(merchantId: string): Promise<{ url: string }> {
    const billing = await this.repository.getOrCreateTrial(
      merchantId,
      14,
    );
    if (!billing.stripeCustomerId) {
      throw new ConflictException("billing_customer_not_created");
    }
    return this.stripe.createBillingPortal({
      customerId: billing.stripeCustomerId,
      returnUrl: `${this.billingConfig.consoleUrl()}/settings/billing`,
    });
  }
}

@Injectable()
export class HandleStripePlatformEventUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async accountUpdated(input: {
    merchantId: string;
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirements: string[];
  }): Promise<void> {
    const current = await this.repository.getConnection(
      input.merchantId,
      "stripe",
    );
    await this.repository.saveConnection({
      merchantId: input.merchantId,
      provider: "stripe",
      environment: current?.environment ?? "test",
      status:
        input.chargesEnabled &&
        input.payoutsEnabled &&
        input.detailsSubmitted &&
        input.requirements.length === 0
          ? "active"
          : "restricted",
      externalAccountId: input.accountId,
      chargesEnabled: input.chargesEnabled,
      payoutsEnabled: input.payoutsEnabled,
      requirements: input.requirements,
      syncedAt: new Date().toISOString(),
    });
  }

  async checkoutCompleted(input: {
    merchantId: string;
    customerId?: string;
    subscriptionId?: string;
  }): Promise<void> {
    await this.repository.saveBilling({
      merchantId: input.merchantId,
      stripeCustomerId: input.customerId,
      stripeSubscriptionId: input.subscriptionId,
      status: "active",
    });
  }

  async subscriptionUpdated(input: {
    merchantId?: string;
    customerId: string;
    subscriptionId: string;
    priceId?: string;
    status: BillingSubscriptionSnapshot["status"];
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    const merchantId =
      input.merchantId ??
      (await this.repository.findMerchantByStripeSubscriptionId(
        input.subscriptionId,
      )) ??
      (await this.repository.findMerchantByStripeCustomerId(
        input.customerId,
      ));
    if (!merchantId) return;
    await this.repository.saveBilling({
      merchantId,
      stripeCustomerId: input.customerId,
      stripeSubscriptionId: input.subscriptionId,
      stripePriceId: input.priceId,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    });
  }
}

async function requiredConnection(
  repository: PaymentPlatformRepository,
  merchantId: string,
  provider: "stripe" | "asaas",
): Promise<PaymentConnectionSnapshot> {
  const connection = await repository.getConnection(merchantId, provider);
  if (!connection) {
    throw new NotFoundException(`${provider}_connection_not_found`);
  }
  return connection;
}

async function requiredAsaasSecret(
  repository: PaymentPlatformRepository,
  merchantId: string,
): Promise<string> {
  const secret = await repository.getConnectionSecret(
    merchantId,
    "asaas",
  );
  if (!secret) throw new ConflictException("asaas_api_key_not_available");
  if (secret.trim().startsWith("{")) {
    const parsed = JSON.parse(secret) as { apiKey?: string };
    if (!parsed.apiKey) throw new ConflictException("asaas_api_key_not_available");
    return parsed.apiKey;
  }
  return secret;
}

function providerGatewayError(
  provider: "stripe" | "asaas",
  error: unknown,
): BadGatewayException {
  return new BadGatewayException({
    code: `${provider}_platform_failed`,
    detail: `${provider} rejected the request or could not be reached.`,
    provider_code: providerErrorCode(error),
  });
}

function providerErrorCode(error: unknown): string {
  return error instanceof Error
    ? error.message.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 120)
    : "provider_error";
}
