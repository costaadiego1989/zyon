import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";
import { AUTH_REPOSITORY, type AuthRepository } from "../auth/domain/ports/auth-repository.port.js";
import { JwtService } from "../auth/domain/services/jwt.service.js";
import { PasswordHasher } from "../auth/domain/services/password-hasher.service.js";
import { Inject, Optional } from "@nestjs/common";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../merchant/domain/ports/merchant-repository.port.js";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository
} from "../merchant/domain/ports/merchant-rules.repository.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository
} from "../payment/domain/ports/payment-platform-repository.port.js";
import { CreateCrossSellPromotionUseCase } from "../cross-sell/application/use-cases/create-cross-sell-promotion.use-case.js";

type TestWebhookDelivery = {
  received_at: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

const webhookReceiverBuckets = new Map<string, TestWebhookDelivery[]>();

@Controller("__test__")
export class TestSeedController {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly passwordHasher: PasswordHasher,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY)
    private readonly merchantRules?: MerchantRulesRepository,
    @Optional() @Inject(MERCHANT_REPOSITORY)
    private readonly merchants?: MerchantRepository,
    @Optional() @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly paymentPlatform?: PaymentPlatformRepository,
    @Optional() private readonly createCrossSell?: CreateCrossSellPromotionUseCase
  ) {}

  @Post("seed")
  async seed(): Promise<{
    merchantId: string;
    embedToken: string;
    accessToken: string;
    productId: string;
  }> {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("test_seed_disabled_in_production");
    }
    const merchantId = `e2e_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const tokens = new EmbedTokenService();
    const now = Math.floor(Date.now() / 1000);
    const embedToken = tokens.sign({
      typ: "aacp_embed_v1",
      merchantId,
      environment: "test",
      issuedAtUnix: now,
      expiresAtUnix: now + 3600,
      nonce: crypto.randomUUID(),
      scopes: [
        "checkout:start",
        "checkout:track",
        "checkout:chat",
        "offers:apply",
        "coupons:apply",
        "payment:intents:create",
        "payment:intents:confirm",
        "payment:intents:read"
      ]
    });

    // Create a real auth merchant + owner sharing the same merchantId, so
    // auth-guarded admin routes (e.g. POST /merchant/coupons, which derives
    // merchant_id from the principal) operate on the same tenant the embed
    // token addresses. Returns a usable bearer access token for tests.
    const email = `${merchantId}@e2e.test`;
    const passwordHash = await this.passwordHasher.hash(`Seed-${crypto.randomUUID()}`);
    const { user } = await this.authRepo.createMerchantWithOwner({
      merchantId,
      merchantName: "E2E Seeded Merchant",
      email,
      passwordHash
    });
    const accessToken = this.jwt.sign({
      userId: user.id,
      merchantId: user.merchantId,
      email: user.email,
      role: user.role
    });

    // BUG 2 — enable crypto for the seeded merchant so the widget shows the
    // "Pagar com crypto" option. The checkout-experience response gates it on
    // rules.cryptoPaymentsEnabled, which is derived from cryptoPayments.enabled.
    await this.merchantRules?.updateRules(merchantId, {
      cryptoPayments: {
        enabled: true,
        chain: "polygon",
        network: "testnet",
        treasuryAddress: "0x0000000000000000000000000000000000000001",
        token: "USDC",
        quoteTtlSeconds: 900,
        brlPerUsdc: 5.5
      }
    });

    // BUG 3 — card "em ativação pelo provedor". The card path in
    // CreatePaymentIntentUseCase throws `stripe_connect_not_active` /
    // `stripe_connect_not_configured` until the merchant has an ACTIVE Stripe
    // platform connection plus a connect account id. Seed both so the card
    // method is usable in e2e. This is a real (test-mode) Stripe connect
    // account — the e2e payment provider stub still returns `requires_action`
    // and never auto-approves, so no success is faked.
    const stripeConnectAccountId = `acct_e2e_${merchantId}`;
    await this.paymentPlatform?.saveConnection({
      merchantId,
      provider: "stripe",
      environment: "test",
      status: "active",
      externalAccountId: stripeConnectAccountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      requirements: [],
      syncedAt: new Date().toISOString()
    });
    await this.merchants?.setStripeConnectAccountId(merchantId, stripeConnectAccountId);

    // Cross-sell — seed one active promotion so the payment-step cross-sell
    // block in SendChatMessageUseCase emits experience.suggestedProducts. The
    // widget sends productId=e2e_product_001 as the cart SKU (see
    // merchant-embed-config.resolveProductSelection), so trigger on that SKU
    // and recommend a complementary item the cross-sell product resolver knows
    // ("CART-COE-01" → "Carteira Slim RFID"). Without an active promotion,
    // findActiveByMerchant returns [] and suggestedProducts stays empty.
    await this.createCrossSell?.execute({
      merchant_id: merchantId,
      name: "E2E Cross-sell — Carteira Slim",
      trigger: { sku_in_cart: ["e2e_product_001"] },
      recommended_skus: ["CART-COE-01"],
      discount_percent: 10,
      max_discount_percent: 15,
      starts_at: new Date(Date.now() - 60_000)
    });

    return { merchantId, embedToken, accessToken, productId: "e2e_product_001" };
  }

  @Post("webhook-receiver/:bucket")
  @HttpCode(204)
  receiveWebhook(
    @Param("bucket") bucket: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>
  ): void {
    assertTestOnly();
    const key = sanitizeBucket(bucket);
    const current = webhookReceiverBuckets.get(key) ?? [];
    current.push({
      received_at: new Date().toISOString(),
      headers: {
        "x-aacp-event-id": headers["x-aacp-event-id"],
        "x-aacp-event-type": headers["x-aacp-event-type"],
        "x-aacp-timestamp": headers["x-aacp-timestamp"],
        "x-aacp-signature": headers["x-aacp-signature"]
      },
      body
    });
    webhookReceiverBuckets.set(key, current.slice(-50));
  }

  @Get("webhook-receiver/:bucket")
  readWebhooks(@Param("bucket") bucket: string): { deliveries: TestWebhookDelivery[] } {
    assertTestOnly();
    return { deliveries: webhookReceiverBuckets.get(sanitizeBucket(bucket)) ?? [] };
  }
}

function assertTestOnly(): void {
  if (process.env.NODE_ENV === "production") {
    throw new ForbiddenException("test_receiver_disabled_in_production");
  }
}

function sanitizeBucket(bucket: string): string {
  return bucket.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "default";
}
