import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryMerchantRepository } from "../../merchant/infrastructure/in-memory-merchant.repository.js";
import type {
  AsaasPlatformPort,
  BillingConfigPort,
  StripePlatformPort,
} from "../domain/ports/payment-platform-provider.port.js";
import type { BillingTrialJobQueue } from "../domain/ports/billing-trial-job-queue.port.js";
import type { AsaasSubaccountInput } from "../domain/payment-platform.types.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import {
  CreateAsaasSubaccountUseCase,
  CreateBillingCheckoutUseCase,
  CreateStripeConnectOnboardingLinkUseCase,
  ExpireBillingTrialsUseCase,
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

  assert.equal(created.status, "pending");
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

  const trial = await get.execute("mrc_bill");
  const session = await checkout.execute({
    merchantId: "mrc_bill",
    email: "billing@example.com",
    plan: "growth",
  });

  assert.equal(trial.status, "trialing");
  assert.equal(session.url, "https://billing.stripe.test/session");
  assert.equal(stripe.lastPriceId, "price_growth_server");
  assert.equal(
    (await repository.getBilling("mrc_bill"))?.stripeCustomerId,
    "cus_mrc_bill",
  );
});

test("billing subscription lookup schedules Redis delayed trial expiration", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const queue = new StubBillingTrialJobQueue();
  const get = new GetBillingSubscriptionUseCase(repository, queue);

  const subscription = await get.execute("mrc_scheduled");

  assert.equal(subscription.status, "trialing");
  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0]?.merchantId, "mrc_scheduled");
  assert.equal(queue.jobs[0]?.trialEndsAt, subscription.trialEndsAt);
});

test("billing trial expiration downgrades unpaid merchants to Starter", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  await repository.saveBilling({
    merchantId: "mrc_expired",
    status: "trialing",
    trialEndsAt: "2026-07-01T00:00:00.000Z",
  });
  await repository.saveBilling({
    merchantId: "mrc_paid_trial",
    status: "trialing",
    trialEndsAt: "2026-07-01T00:00:00.000Z",
    stripeSubscriptionId: "sub_paid",
  });

  const expired = await new ExpireBillingTrialsUseCase(repository).execute({
    now: new Date("2026-07-22T00:00:00.000Z"),
  });

  assert.equal(expired, 1);
  assert.equal((await repository.getBilling("mrc_expired"))?.status, "starter");
  assert.equal((await repository.getBilling("mrc_expired"))?.trialEndsAt, undefined);
  assert.equal((await repository.getBilling("mrc_paid_trial"))?.status, "trialing");
});

class StubBillingTrialJobQueue implements BillingTrialJobQueue {
  readonly jobs: Array<{ merchantId: string; trialEndsAt: string }> = [];

  async scheduleTrialExpiration(input: { merchantId: string; trialEndsAt: string }): Promise<void> {
    this.jobs.push(input);
  }
}

class StubStripePlatform implements StripePlatformPort {
  accountCreations = 0;
  requirements: string[] = [];
  lastPriceId?: string;

  async createConnectAccount(input: { merchantId: string }) {
    this.accountCreations += 1;
    return { accountId: `acct_${input.merchantId}` };
  }

  async createConnectOnboardingLink() {
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
}

class StubBillingConfig implements BillingConfigPort {
  priceId(plan: "starter" | "growth" | "scale"): string {
    return `price_${plan}_server`;
  }

  consoleUrl(): string {
    return "https://console.aacp.test";
  }
}

function asaasInput(): AsaasSubaccountInput {
  return {
    name: "AACP Merchant",
    email: "owner@example.com",
    cpfCnpj: "12345678901",
    mobilePhone: "11999999999",
    incomeValue: 10_000,
    address: "Rua Principal",
    addressNumber: "100",
    province: "Centro",
    postalCode: "01001000",
  };
}
