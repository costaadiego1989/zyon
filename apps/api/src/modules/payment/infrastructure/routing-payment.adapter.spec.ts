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

class FakeAsaas implements Pick<PaymentProviderPort, "createPayment" | "fetchPaymentStatus" | "createCustomer"> {
  calls: CreateProviderPaymentInput[] = [];
  fetchCalls: FetchPaymentStatusInput[] = [];

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
