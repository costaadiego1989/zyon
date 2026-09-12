import test from "node:test";
import assert from "node:assert/strict";
import { RoutingPaymentAdapter } from "./routing-payment.adapter.js";
import { InMemoryPaymentPlatformRepository } from "./in-memory-payment-platform.repository.js";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";
import type { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import type { StripePaymentAdapter } from "./stripe-payment.adapter.js";
import type { EvmCryptoPaymentAdapter } from "./evm-crypto-payment.adapter.js";
import type { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";

class FakeStripe implements Pick<PaymentProviderPort, "createPayment" | "fetchPaymentStatus"> {
  calls: CreateProviderPaymentInput[] = [];
  fetchCalls: FetchPaymentStatusInput[] = [];

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    this.calls.push(input);
    return { providerPaymentId: "pi_stripe_fake", status: "requires_action", buyerFacingPayload: { clientSecret: "cs_x" } };
  }

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    this.fetchCalls.push(input);
    return { state: "approved", approvedAmountCents: input.providerPaymentId === "pi_approved" ? 5000 : undefined };
  }
}

class FakeAsaas implements Pick<PaymentProviderPort, "createPayment" | "fetchPaymentStatus" | "createCustomer" | "refundPayment"> {
  calls: CreateProviderPaymentInput[] = [];
  fetchCalls: FetchPaymentStatusInput[] = [];
  refundCalls: Array<{ merchantId: string; providerPaymentId: string; amountCents: number }> = [];

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    this.calls.push(input);
    return { providerPaymentId: "asaas_pay_fake", status: "requires_action", buyerFacingPayload: { qrCodeCopyPaste: "pix_code" } };
  }

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    this.fetchCalls.push(input);
    return { state: "pending" };
  }

  async createCustomer(): Promise<string> {
    return "cus_asaas_fake";
  }

  async refundPayment(input: { merchantId: string; providerPaymentId: string; amountCents: number }) {
    this.refundCalls.push(input);
    return { refundId: "refund_asaas_fake", status: "pending" as const };
  }
}

class FakeCrypto implements Pick<PaymentProviderPort, "createPayment"> {
  calls: CreateProviderPaymentInput[] = [];

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    this.calls.push(input);
    return {
      providerPaymentId: `crypto_${input.intentId}`,
      status: "requires_action",
      buyerFacingPayload: {
        chainId: 137,
        chain: "polygon",
        evmNetwork: "mainnet",
        chainLabel: "Polygon",
        tokenAddress: "0xtoken",
        tokenSymbol: "USDC",
        amountAtomic: "1000000",
        amountDisplay: "1.00 USDC",
        destinationAddress: "0xdest",
        quoteExpiresAt: new Date(Date.now() + 900_000).toISOString()
      }
    };
  }
}

function baseInput(overrides?: Partial<CreateProviderPaymentInput>): CreateProviderPaymentInput {
  return {
    merchantId: "mrc_1",
    sessionId: "chk_1",
    intentId: "pay_int_test",
    amountCents: 5000,
    currency: "BRL",
    method: "pix",
    ...overrides
  };
}

test("RoutingPaymentAdapter: routes crypto to EvmCryptoPaymentAdapter", async () => {
  const crypto = new FakeCrypto();
  const adapter = new RoutingPaymentAdapter(
    null, null, null as unknown as MercadoPagoPaymentAdapter,
    crypto as unknown as EvmCryptoPaymentAdapter
  );

  const result = await adapter.createPayment(baseInput({ method: "crypto" }));
  assert.equal(result.providerPaymentId, "crypto_pay_int_test");
  assert.equal(crypto.calls.length, 1);
});

test("RoutingPaymentAdapter: routes card to Stripe when configured", async () => {
  const stripe = new FakeStripe();
  const crypto = new FakeCrypto();
  const adapter = new RoutingPaymentAdapter(
    stripe as unknown as StripePaymentAdapter,
    null, null as unknown as MercadoPagoPaymentAdapter,
    crypto as unknown as EvmCryptoPaymentAdapter
  );

  const result = await adapter.createPayment(baseInput({ method: "card" }));
  assert.equal(result.providerPaymentId, "pi_stripe_fake");
  assert.equal(stripe.calls.length, 1);
});

test("RoutingPaymentAdapter: routes pix/boleto to Asaas fallback when no platform connection", async () => {
  const asaas = new FakeAsaas();
  const crypto = new FakeCrypto();
  const adapter = new RoutingPaymentAdapter(
    null,
    asaas as unknown as AsaasPaymentAdapter,
    null as unknown as MercadoPagoPaymentAdapter,
    crypto as unknown as EvmCryptoPaymentAdapter
  );

  const result = await adapter.createPayment(baseInput({ method: "pix" }));
  assert.equal(result.providerPaymentId, "asaas_pay_fake");
  assert.equal(asaas.calls.length, 1);
});

test("RoutingPaymentAdapter: delayed Asaas payment uses the platform adapter, never tenant credentials", async () => {
  const platformAsaas = new FakeAsaas();
  const platformRepo = new InMemoryPaymentPlatformRepository();
  await platformRepo.saveConnection({
    merchantId: "mrc_tenant",
    provider: "asaas",
    environment: "live",
    status: "active",
    walletId: "wallet_merchant",
    secret: "tenant_api_key",
  });
  const adapter = new RoutingPaymentAdapter(
    null,
    platformAsaas as unknown as AsaasPaymentAdapter,
    null as unknown as MercadoPagoPaymentAdapter,
    new FakeCrypto() as unknown as EvmCryptoPaymentAdapter,
    platformRepo,
    "https://asaas-api.test",
  );

  await adapter.createPayment(baseInput({
    merchantId: "mrc_tenant",
    provider: "asaas",
    settlementMode: "delayed_merchant_payout",
    merchantPayoutDestination: "wallet_merchant",
  }));

  assert.equal(platformAsaas.calls.length, 1);
  assert.equal(platformAsaas.calls[0].settlementMode, "delayed_merchant_payout");
});

test("RoutingPaymentAdapter: delayed Asaas refund uses the platform account that captured the charge", async () => {
  const platformAsaas = new FakeAsaas();
  const platformRepo = new InMemoryPaymentPlatformRepository();
  await platformRepo.saveConnection({
    merchantId: "mrc_tenant",
    provider: "asaas",
    environment: "live",
    status: "active",
    walletId: "wallet_merchant",
    secret: "tenant_api_key",
  });
  const adapter = new RoutingPaymentAdapter(
    null,
    platformAsaas as unknown as AsaasPaymentAdapter,
    null as unknown as MercadoPagoPaymentAdapter,
    new FakeCrypto() as unknown as EvmCryptoPaymentAdapter,
    platformRepo,
    "https://asaas-api.test",
  );

  await adapter.refundPayment({
    merchantId: "mrc_tenant",
    provider: "asaas",
    settlementMode: "delayed_merchant_payout",
    providerPaymentId: "pay_platform_charge",
    amountCents: 3_089,
  });

  assert.deepEqual(platformAsaas.refundCalls, [{
    merchantId: "mrc_tenant",
    provider: "asaas",
    settlementMode: "delayed_merchant_payout",
    providerPaymentId: "pay_platform_charge",
    amountCents: 3_089,
  }]);
});

test("RoutingPaymentAdapter: throws when no provider is configured for pix", async () => {
  const crypto = new FakeCrypto();
  const platformRepo = new InMemoryPaymentPlatformRepository();
  const adapter = new RoutingPaymentAdapter(
    null, null, null as unknown as MercadoPagoPaymentAdapter,
    crypto as unknown as EvmCryptoPaymentAdapter,
    platformRepo,
    "https://asaas.test"
  );

  await assert.rejects(
    () => adapter.createPayment(baseInput({ method: "pix" })),
    /asaas_connection_not_active/
  );
});

test("RoutingPaymentAdapter: fetchPaymentStatus routes pi_ ids to Stripe", async () => {
  const stripe = new FakeStripe();
  const crypto = new FakeCrypto();
  const adapter = new RoutingPaymentAdapter(
    stripe as unknown as StripePaymentAdapter,
    null, null as unknown as MercadoPagoPaymentAdapter,
    crypto as unknown as EvmCryptoPaymentAdapter
  );

  const result = await adapter.fetchPaymentStatus({ merchantId: "mrc_1", providerPaymentId: "pi_approved" });
  assert.equal(result.state, "approved");
  assert.equal(stripe.fetchCalls.length, 1);
});

test("RoutingPaymentAdapter: fetchPaymentStatus routes non-pi_ ids to Asaas fallback", async () => {
  const asaas = new FakeAsaas();
  const crypto = new FakeCrypto();
  const adapter = new RoutingPaymentAdapter(
    null,
    asaas as unknown as AsaasPaymentAdapter,
    null as unknown as MercadoPagoPaymentAdapter,
    crypto as unknown as EvmCryptoPaymentAdapter
  );

  const result = await adapter.fetchPaymentStatus({ merchantId: "mrc_1", providerPaymentId: "asaas_pay_xyz" });
  assert.equal(result.state, "pending");
  assert.equal(asaas.fetchCalls.length, 1);
});

test("RoutingPaymentAdapter: uses tenant-specific Asaas key from platform connection", async () => {
  const crypto = new FakeCrypto();
  const platformRepo = new InMemoryPaymentPlatformRepository();

  // Seed an active connection with a secret
  await platformRepo.saveConnection({
    merchantId: "mrc_tenant",
    provider: "asaas",
    environment: "live",
    status: "active",
    externalAccountId: "sub_123",
    secret: "tenant_api_key"
  });

  let fetchedUrl = "";
  let fetchedKey = "";
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    fetchedUrl = String(url);
    const authHeader = (init?.headers as Record<string, string>)?.["access_token"] ?? "";
    fetchedKey = authHeader;
    return new Response(JSON.stringify({
      id: "pay_new",
      status: "PENDING",
      invoiceUrl: "https://x.test",
      pixQrCodeUrl: null
    }), { status: 200 });
  };

  const adapter = new RoutingPaymentAdapter(
    null, null, null as unknown as MercadoPagoPaymentAdapter,
    crypto as unknown as EvmCryptoPaymentAdapter,
    platformRepo,
    "https://asaas-api.test",
    undefined,
    fakeFetch as unknown as typeof fetch
  );

  const result = await adapter.createPayment(baseInput({ merchantId: "mrc_tenant", method: "pix" }));
  assert.equal(result.providerPaymentId, "pay_new");
  assert.ok(fetchedUrl.includes("asaas-api.test"));
});

test("RoutingPaymentAdapter: rejects a tenant Asaas wallet that matches the platform wallet", async () => {
  const previousPlatformWallet = process.env.ASAAS_PLATFORM_WALLET_ID;
  process.env.ASAAS_PLATFORM_WALLET_ID = "wallet_platform";
  try {
    const platformRepo = new InMemoryPaymentPlatformRepository();
    await platformRepo.saveConnection({
      merchantId: "mrc_tenant",
      provider: "asaas",
      environment: "live",
      status: "active",
      walletId: "wallet_platform",
      secret: "tenant_api_key"
    });
    const adapter = new RoutingPaymentAdapter(
      null, null, null as unknown as MercadoPagoPaymentAdapter,
      new FakeCrypto() as unknown as EvmCryptoPaymentAdapter,
      platformRepo,
      "https://asaas-api.test"
    );

    await assert.rejects(
      () => adapter.preparePayment(baseInput({ merchantId: "mrc_tenant", method: "pix", platformFeeCents: 99 })),
      /asaas_merchant_wallet_matches_platform_wallet/
    );
  } finally {
    if (previousPlatformWallet === undefined) delete process.env.ASAAS_PLATFORM_WALLET_ID;
    else process.env.ASAAS_PLATFORM_WALLET_ID = previousPlatformWallet;
  }
});

test("RoutingPaymentAdapter: createCustomer delegates to Asaas", async () => {
  const asaas = new FakeAsaas();
  const crypto = new FakeCrypto();
  const adapter = new RoutingPaymentAdapter(
    null,
    asaas as unknown as AsaasPaymentAdapter,
    null as unknown as MercadoPagoPaymentAdapter,
    crypto as unknown as EvmCryptoPaymentAdapter
  );

  const customerId = await adapter.createCustomer({
    merchantId: "mrc_1",
    name: "Buyer",
    email: "buyer@example.com",
    cpfCnpj: "12345678900"
  });
  assert.equal(customerId, "cus_asaas_fake");
});

test("preparePayment pins active Asaas when merchant Stripe is inactive", async () => {
  const repo = new InMemoryPaymentPlatformRepository();
  await repo.saveConnection({ merchantId: "mrc_1", provider: "asaas", status: "active", environment: "test" });
  const stripe = new FakeStripe();
  const asaas = new FakeAsaas();
  const adapter = new RoutingPaymentAdapter(stripe as unknown as StripePaymentAdapter, asaas as unknown as AsaasPaymentAdapter, null, new FakeCrypto() as unknown as EvmCryptoPaymentAdapter, repo);
  const prepared = await adapter.preparePayment(baseInput({ method: "card", platformFeeCents: 99 }));
  assert.equal(prepared.provider, "asaas");
  await adapter.createPayment(prepared);
  assert.equal(stripe.calls.length, 0);
  assert.equal(asaas.calls[0].platformFeeCents, 99);
});
