import assert from "node:assert/strict";
import test from "node:test";
import { Logger } from "@nestjs/common";
import { toProblemDetails } from "../../../shared/http/problem-details.filter.js";
import { InMemoryMerchantRepository } from "../../merchant/infrastructure/in-memory-merchant.repository.js";
import type {
  AsaasPlatformPort,
  BillingConfigPort,
  StripePlatformPort,
} from "../domain/ports/payment-platform-provider.port.js";
import type { AsaasSubaccountInput } from "../domain/payment-platform.types.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import {
  CreateAsaasSubaccountUseCase,
  CreateBillingCheckoutUseCase,
  CreateStripeConnectOnboardingLinkUseCase,
  GetBillingSubscriptionUseCase,
  SyncAsaasSubaccountUseCase,
  SyncStripeConnectUseCase,
} from "./payment-platform.use-cases.js";

const environment = { stripe: "test", asaas: "test" } as const;

test("Stripe onboarding provisions once and exposes only a hosted one-time URL", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const merchants = new InMemoryMerchantRepository();
  merchants.seedProfile({ id: "mrc_1", name: "AACP Store" });
  const stripe = new StubStripePlatform();
  const useCase = new CreateStripeConnectOnboardingLinkUseCase(
    repository,
    stripe,
    environment,
    merchants,
    new StubBillingConfig(),
  );

  const first = await useCase.execute({
    merchantId: "mrc_1",
    email: "owner@example.com",
  });
  const second = await useCase.execute({
    merchantId: "mrc_1",
    email: "owner@example.com",
  });

  assert.equal(stripe.accountCreations, 1);
  assert.equal(first.url, "https://connect.stripe.test/onboard");
  assert.equal(second.connection.externalAccountId, "acct_mrc_1");
  assert.equal("secret" in first.connection, false);
  assert.equal(
    await merchants.getStripeConnectAccountId("mrc_1"),
    "acct_mrc_1",
  );
});

test("Stripe sync records restricted requirements before activation", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  await repository.saveConnection({
    merchantId: "mrc_1",
    provider: "stripe",
    environment: "test",
    status: "pending",
    externalAccountId: "acct_mrc_1",
  });
  const stripe = new StubStripePlatform();
  stripe.requirements = ["individual.verification.document"];
  const sync = new SyncStripeConnectUseCase(
    repository,
    stripe,
    environment,
  );

  const connection = await sync.execute("mrc_1");

  assert.equal(connection.status, "restricted");
  assert.deepEqual(connection.requirements, [
    "individual.verification.document",
  ]);
});

test("Stripe Connect activation error is actionable and never persists a connection", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const merchants = new InMemoryMerchantRepository();
  merchants.seedProfile({ id: "mrc_stripe_error", name: "Test" });
  const stripe = new StubStripePlatform();
  stripe.createConnectAccount = async () => { throw new Error("You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect."); };
  const useCase = new CreateStripeConnectOnboardingLinkUseCase(repository, stripe, environment, merchants, new StubBillingConfig());
  await assert.rejects(() => useCase.execute({ merchantId: "mrc_stripe_error", email: "owner@example.com" }), error => {
    const problem = toProblemDetails(error, "test");
    assert.equal(problem.status, 503);
    assert.equal(problem.code, "stripe_connect_not_enabled");
    return true;
  });
  assert.equal(await repository.getConnection("mrc_stripe_error", "stripe"), undefined);
});

test("Stripe returns to onboarding and keeps the pending account when a link must be retried", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const merchants = new InMemoryMerchantRepository();
  merchants.seedProfile({ id: "mrc_return", name: "Test" });
  const stripe = new StubStripePlatform();
  let fail = true;
  stripe.createConnectOnboardingLink = async (input) => {
    assert.equal(input.returnUrl, "https://console.aacp.test/?stripe_connected=1#onboarding");
    assert.equal(input.refreshUrl, "https://console.aacp.test/?stripe_refresh=1#onboarding");
    if (fail) throw new Error("network failed with sensitive provider data");
    return { url: "https://connect.stripe.test/onboard" };
  };
  const useCase = new CreateStripeConnectOnboardingLinkUseCase(repository, stripe, environment, merchants, new StubBillingConfig());
  const input = { merchantId: "mrc_return", email: "owner@example.com", returnTo: "onboarding" as const };
  await assert.rejects(() => useCase.execute(input), error => {
    assert.equal(toProblemDetails(error, "test").code, "stripe_connect_unavailable");
    assert.doesNotMatch(JSON.stringify(toProblemDetails(error, "test")), /sensitive/);
    return true;
  });
  assert.equal((await repository.getConnection("mrc_return", "stripe"))?.status, "pending");
  fail = false;
  await useCase.execute(input);
  assert.equal(stripe.accountCreations, 1);
});

test("Asaas never fabricates identity fields or persists a failed account creation", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const asaas = new StubAsaasPlatform();
  const create = new CreateAsaasSubaccountUseCase(repository, asaas, environment);
  await assert.rejects(() => create.execute("mrc_asaas", { ...asaasInput(), birthDate: undefined }), /asaas_birth_date_required/);
  await assert.rejects(() => create.execute("mrc_asaas", { ...asaasInput(), cpfCnpj: "11222333000181", companyType: undefined }), /asaas_company_type_required/);
  asaas.createSubaccount = async () => { throw new Error("provider denied creation"); };
  await assert.rejects(() => create.execute("mrc_asaas", asaasInput()));
  assert.equal(await repository.getConnection("mrc_asaas", "asaas"), undefined);
});

test("Asaas subaccount credentials remain encrypted behind the repository and drive tenant status", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const asaas = new StubAsaasPlatform();
  const create = new CreateAsaasSubaccountUseCase(
    repository,
    asaas,
    environment,
  );
  const sync = new SyncAsaasSubaccountUseCase(repository, asaas);

  const created = await create.execute("mrc_asaas", asaasInput());
  const synced = await sync.execute("mrc_asaas");

  assert.equal(created.status, "active");
  assert.equal("apiKey" in created, false);
  assert.equal(
    await repository.getConnectionSecret("mrc_asaas", "asaas"),
    "asaas_subaccount_secret",
  );
  assert.equal(synced.status, "active");
  assert.equal(synced.chargesEnabled, true);
});

test("billing creates a local trial and server-configured Stripe checkout", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const merchants = new InMemoryMerchantRepository();
  merchants.seedProfile({ id: "mrc_bill", name: "Billing Store" });
  const stripe = new StubStripePlatform();
  const config = new StubBillingConfig();
  const get = new GetBillingSubscriptionUseCase(repository);
  const checkout = new CreateBillingCheckoutUseCase(
    repository,
    stripe,
    merchants,
    config,
  );

  const trial = await withCapturedWarnings(() => get.execute("mrc_bill"));
  const session = await checkout.execute({
    merchantId: "mrc_bill",
    email: "billing@example.com",
    plan: "growth",
  });

  assert.equal(trial.result.status, "trialing");
  assert.match(trial.warnings.join("\n"), /billing_trial_queue_fallback/);
  assert.equal(session.url, "https://billing.stripe.test/session");
  assert.equal(stripe.lastPriceId, "price_growth_server");
  assert.equal(
    (await repository.getBilling("mrc_bill"))?.stripeCustomerId,
    "cus_mrc_bill",
  );
});

test("billing trial fails fast when queue is required", async () => {
  const previous = process.env.BILLING_TRIAL_QUEUE_REQUIRED;
  process.env.BILLING_TRIAL_QUEUE_REQUIRED = "true";
  try {
    const get = new GetBillingSubscriptionUseCase(new InMemoryPaymentPlatformRepository());
    await assert.rejects(() => get.execute("mrc_bill"), /billing_trial_queue_not_configured/);
  } finally {
    if (previous === undefined) delete process.env.BILLING_TRIAL_QUEUE_REQUIRED;
    else process.env.BILLING_TRIAL_QUEUE_REQUIRED = previous;
  }
});

class StubStripePlatform implements StripePlatformPort {
  async retrieveBillingSubscription(subscriptionId: string) {
    return { subscriptionId, customerId: "cus_test", priceId: "growth", status: "active" as const, cancelAtPeriodEnd: false };
  }

  async listBillingInvoices() { return []; }

  accountCreations = 0;
  requirements: string[] = [];
  lastPriceId?: string;

  async createConnectAccount(input: { merchantId: string }) {
    this.accountCreations += 1;
    return { accountId: `acct_${input.merchantId}` };
  }

  async createConnectOnboardingLink(_input: { accountId: string; refreshUrl: string; returnUrl: string }) {
    return { url: "https://connect.stripe.test/onboard" };
  }

  async retrieveConnectAccount(accountId: string) {
    return {
      accountId,
      chargesEnabled: this.requirements.length === 0,
      payoutsEnabled: this.requirements.length === 0,
      detailsSubmitted: true,
      requirements: this.requirements,
    };
  }

  async createBillingCustomer(input: { merchantId: string }) {
    return { customerId: `cus_${input.merchantId}` };
  }

  async createSubscriptionCheckout(input: { priceId: string }) {
    this.lastPriceId = input.priceId;
    return {
      url: "https://billing.stripe.test/session",
      sessionId: "cs_test_1",
    };
  }

  async createBillingPortal() {
    return { url: "https://billing.stripe.test/portal" };
  }
}

class StubAsaasPlatform implements AsaasPlatformPort {
  async resolvePlatformAccount() { return null; }
  async createSubaccount(_input: AsaasSubaccountInput) {
    return {
      accountId: "asaas_account_1",
      walletId: "wallet_1",
      apiKey: "asaas_subaccount_secret",
    };
  }

  async retrieveAccountStatus(apiKey: string) {
    assert.equal(apiKey, "asaas_subaccount_secret");
    return {
      general: "APPROVED",
      commercialInfo: "APPROVED",
      bankAccountInfo: "APPROVED",
      documentation: "APPROVED",
    };
  }

  async listOnboardingLinks() {
    return ["https://cadastro.asaas.com/onboarding/test"];
  }

  async findSubaccountByCpfCnpj(_cpfCnpj: string) {
    // Default: no pre-existing subaccount, so the create path runs.
    return null;
  }

  async createSubaccountApiKey(_accountId: string) {
    return { apiKey: "asaas_subaccount_secret" };
  }

  async retrieveWalletId(_apiKey: string) {
    return "wallet_1";
  }

  async approveSandboxAccount(_apiKey: string) {
    return;
  }
}

class StubBillingConfig implements BillingConfigPort {
  priceId(plan: "starter" | "growth" | "scale"): string {
    return `price_${plan}_server`;
  }

  consoleUrl(): string {
    return "https://console.aacp.test";
  }
}

async function withCapturedWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const previous = Logger.warn;
  const warnings: string[] = [];
  Logger.warn = (message?: unknown) => { warnings.push(String(message)); };
  try {
    return { result: await fn(), warnings };
  } finally {
    Logger.warn = previous;
  }
}

function asaasInput(): AsaasSubaccountInput {
  return {
    name: "AACP Merchant",
    email: "owner@example.com",
    cpfCnpj: "12345678901",
    birthDate: "1990-01-31",
    mobilePhone: "11999999999",
    incomeValue: 10_000,
    address: "Rua Principal",
    addressNumber: "100",
    province: "Centro",
    postalCode: "01001000",
  };
}
