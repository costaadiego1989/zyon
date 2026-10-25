import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UpdateEmbedCustomerUseCase } from "./update-embed-customer.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";

class MockWebhookPublisher {
  async publish() {
    return [];
  }
}

class MockWebhookDispatcher {
  async dispatchDelivery() {}
}

describe("UpdateEmbedCustomerUseCase", () => {
  it("changing a verified email clears identity, challenge, profile and freight authority", async () => {
    const repo = new InMemoryCheckoutRepository();
    await repo.saveSession(checkoutSession({
      globalUserId: "verified-buyer",
      customer: {
        email: "verified@example.com", email_verified: true, otp_code: "123456",
        recognized_buyer: true, isReturning: true, externalCustomerId: "customer-1", asaasCustomerId: "cus_1",
        phone: "11999999999", phone_verified: true, phone_otp_code: "654321",
        address: { street: "Private address" }, address_verified: true,
      },
    }));
    const useCase = new UpdateEmbedCustomerUseCase(repo, new MockWebhookPublisher() as never, new MockWebhookDispatcher() as never);
    await useCase.execute({ merchantId: "mrc_1", sessionId: "chk_1", customer: {
      email: "other@example.com", fullName: "Other buyer", cpf: "12345678900", phone: "11999999999",
    } });
    const stored = repo.getSession("mrc_1", "chk_1")!;
    assert.notEqual(stored.globalUserId, "verified-buyer");
    assert.equal(stored.customer?.email_verified, false);
    assert.equal(stored.customer?.phone_verified, false);
    assert.equal(stored.customer?.otp_code, "");
    assert.equal(stored.customer?.address, undefined);
    assert.equal(stored.customer?.asaasCustomerId, undefined);
    assert.equal(stored.customer?.externalCustomerId, undefined);
    assert.equal(stored.shipping, undefined);
  });

  it("a normalized unchanged verified email retains its proof and buyer identity", async () => {
    const repo = new InMemoryCheckoutRepository();
    await repo.saveSession(checkoutSession({ customer: { email: "buyer@example.com", email_verified: true, phone: "11999999999", phone_verified: true } }));
    const useCase = new UpdateEmbedCustomerUseCase(repo, new MockWebhookPublisher() as never, new MockWebhookDispatcher() as never);
    await useCase.execute({ merchantId: "mrc_1", sessionId: "chk_1", customer: {
      email: " BUYER@EXAMPLE.COM ", fullName: "Buyer", cpf: "12345678900", phone: "11888888888",
    } });
    const stored = repo.getSession("mrc_1", "chk_1")!;
    assert.equal(stored.globalUserId, "usr_1");
    assert.equal(stored.customer?.email_verified, true);
    assert.equal(stored.customer?.phone_verified, false);
  });

  it("persists customer data and emits funnel events", async () => {
    const repo = new InMemoryCheckoutRepository();
    const session = checkoutSession({ merchantId: "mrc_a", sessionId: "chk_a" });
    await repo.saveSession(session);

    const useCase = new UpdateEmbedCustomerUseCase(
      repo,
      new MockWebhookPublisher() as never,
      new MockWebhookDispatcher() as never
    );

    const result = await useCase.execute({
      merchantId: "mrc_a",
      sessionId: "chk_a",
      customer: {
        fullName: "Joao Silva",
        email: "joao@teste.com",
        cpf: "123.456.789-00",
        phone: "21999999999"
      }
    });

    assert.deepEqual(result, { ok: true });

    const persisted = await repo.getSession("mrc_a", "chk_a");
    assert.equal(persisted?.customer?.fullName, "Joao Silva");
    assert.equal(persisted?.customer?.email, "joao@teste.com");
    assert.equal(persisted?.customer?.cpf, "12345678900");
    assert.equal(persisted?.customer?.phone, "21999999999");
  });

  it("normalizes cpf by removing non-digits", async () => {
    const repo = new InMemoryCheckoutRepository();
    await repo.saveSession(checkoutSession({ merchantId: "mrc_a", sessionId: "chk_a" }));

    const useCase = new UpdateEmbedCustomerUseCase(
      repo,
      new MockWebhookPublisher() as never,
      new MockWebhookDispatcher() as never
    );

    await useCase.execute({
      merchantId: "mrc_a",
      sessionId: "chk_a",
      customer: {
        fullName: "Test",
        email: "test@test.com",
        cpf: "111.222.333-44",
        phone: "11999999999"
      }
    });

    const persisted = await repo.getSession("mrc_a", "chk_a");
    assert.equal(persisted?.customer?.cpf, "11122233344");
  });

  it("throws when session not found", async () => {
    const repo = new InMemoryCheckoutRepository();
    const useCase = new UpdateEmbedCustomerUseCase(
      repo,
      new MockWebhookPublisher() as never,
      new MockWebhookDispatcher() as never
    );

    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "mrc_a",
          sessionId: "missing",
          customer: {
            fullName: "Test",
            email: "test@test.com",
            cpf: "12345678900"
          }
        }),
      (err: any) => err?.message === "checkout_session_not_found"
    );
  });
});
