import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RemoveSavedAddressUseCase } from "./remove-saved-address.use-case.js";
import { DeleteSavedPaymentMethodUseCase } from "./delete-saved-payment-method.use-case.js";
import { ListTemplatesForBuyerUseCase } from "./list-templates-for-buyer.use-case.js";
import { UpdateConsentUseCase } from "./update-consent.use-case.js";
import { InMemoryBuyerUserRepository } from "../../infrastructure/repositories/in-memory-buyer-user.repository.js";
import { InMemoryBuyerWalletRepository } from "../../infrastructure/repositories/in-memory-buyer-wallet.repository.js";
import { InMemoryBuyerTemplateRepository } from "../../infrastructure/repositories/in-memory-buyer-template.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { BuyerUserEntity } from "../../domain/entities/buyer-user.entity.js";
import { BuyerWalletEntity } from "../../domain/entities/buyer-wallet.entity.js";
import { BuyerCheckoutTemplateEntity } from "../../domain/entities/buyer-checkout-template.entity.js";
import { CURRENT_CONSENT_VERSION } from "../../domain/policies/consent.policy.js";

function makeRepos() {
  return {
    users: new InMemoryBuyerUserRepository(),
    wallets: new InMemoryBuyerWalletRepository(),
    templates: new InMemoryBuyerTemplateRepository(),
    outbox: new InMemoryOutboxRepository(),
  };
}

async function setupUserAndWallet(repos: ReturnType<typeof makeRepos>) {
  const user = BuyerUserEntity.create({
    email: "u@t.com",
    password_hash: "h",
    consent_version: CURRENT_CONSENT_VERSION,
    marketing_opt_in: false,
  });
  let wallet = BuyerWalletEntity.create(user.id);
  wallet = wallet.addAddress({
    label: "Home",
    zip_code: "01310-100",
    street: "Av. Paulista",
    city: "São Paulo",
    state: "SP",
    country: "BR",
    is_default: true,
  });
  await repos.users.save(user);
  await repos.wallets.save(wallet);
  return { user, wallet };
}

// ---------------------------------------------------------------------------
// RemoveSavedAddressUseCase
// ---------------------------------------------------------------------------
describe("RemoveSavedAddressUseCase", () => {
  it("removes address from wallet", async () => {
    const repos = makeRepos();
    const { user, wallet } = await setupUserAndWallet(repos);
    const addressId = wallet.saved_addresses[0].id;

    const useCase = new RemoveSavedAddressUseCase(repos.wallets);
    await useCase.execute(user.id, addressId);

    const updated = await repos.wallets.findByBuyerUserId(user.id);
    assert.equal(updated!.saved_addresses.length, 0);
  });

  it("no-op when address_id does not exist in wallet", async () => {
    const repos = makeRepos();
    const { user } = await setupUserAndWallet(repos);

    const useCase = new RemoveSavedAddressUseCase(repos.wallets);
    // Should not throw — just saves wallet unchanged
    await useCase.execute(user.id, "non_existent_address");

    const updated = await repos.wallets.findByBuyerUserId(user.id);
    assert.equal(updated!.saved_addresses.length, 1);
  });

  it("throws NotFoundException when wallet not found", async () => {
    const repos = makeRepos();
    const useCase = new RemoveSavedAddressUseCase(repos.wallets);

    await assert.rejects(
      () => useCase.execute("ghost_user", "any_addr"),
      { message: "WALLET_NOT_FOUND" }
    );
  });
});

// ---------------------------------------------------------------------------
// DeleteSavedPaymentMethodUseCase
// ---------------------------------------------------------------------------
describe("DeleteSavedPaymentMethodUseCase", () => {
  async function setupWithPaymentMethod(repos: ReturnType<typeof makeRepos>) {
    const user = BuyerUserEntity.create({
      email: "pm@t.com",
      password_hash: "h",
      consent_version: CURRENT_CONSENT_VERSION,
      marketing_opt_in: false,
    });
    let wallet = BuyerWalletEntity.create(user.id);
    const { wallet: walletWithPm, method } = wallet.addPaymentMethod({
      label: "Visa",
      gateway: "asaas",
      gateway_token: "tok_1",
      last_four: "1111",
      brand: "visa",
      expires_at: new Date("2028-12-01"),
      is_default: true,
    });
    await repos.users.save(user);
    await repos.wallets.save(walletWithPm);
    return { user, method };
  }

  it("deletes payment method from wallet", async () => {
    const repos = makeRepos();
    const { user, method } = await setupWithPaymentMethod(repos);

    const useCase = new DeleteSavedPaymentMethodUseCase(repos.wallets);
    await useCase.execute(user.id, method.id);

    const updated = await repos.wallets.findByBuyerUserId(user.id);
    assert.equal(updated!.saved_payment_methods.length, 0);
  });

  it("no-op when method_id does not exist in wallet", async () => {
    const repos = makeRepos();
    const { user } = await setupWithPaymentMethod(repos);

    const useCase = new DeleteSavedPaymentMethodUseCase(repos.wallets);
    await useCase.execute(user.id, "non_existent_method");

    const updated = await repos.wallets.findByBuyerUserId(user.id);
    assert.equal(updated!.saved_payment_methods.length, 1);
  });

  it("throws NotFoundException when wallet not found", async () => {
    const repos = makeRepos();
    const useCase = new DeleteSavedPaymentMethodUseCase(repos.wallets);

    await assert.rejects(
      () => useCase.execute("ghost_user", "any_method"),
      { message: "WALLET_NOT_FOUND" }
    );
  });
});

// ---------------------------------------------------------------------------
// ListTemplatesForBuyerUseCase
// ---------------------------------------------------------------------------
describe("ListTemplatesForBuyerUseCase", () => {
  it("returns only active templates for the buyer", async () => {
    const repos = makeRepos();
    const t1 = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "user_1",
      merchant_id: "mrc_1",
      name: "Active 1",
      saved_address_id: "a",
      saved_payment_method_id: "p",
      preferred_shipping_method_id: null,
    });
    const t2 = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "user_1",
      merchant_id: "mrc_2",
      name: "Active 2",
      saved_address_id: "a",
      saved_payment_method_id: "p",
      preferred_shipping_method_id: null,
    });
    const t3 = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "user_1",
      merchant_id: "mrc_1",
      name: "Deactivated",
      saved_address_id: "a",
      saved_payment_method_id: "p",
      preferred_shipping_method_id: null,
    }).deactivate();

    await repos.templates.save(t1);
    await repos.templates.save(t2);
    await repos.templates.save(t3);

    const useCase = new ListTemplatesForBuyerUseCase(repos.templates);
    const result = await useCase.execute("user_1");

    assert.equal(result.length, 2);
    assert.ok(result.every((t) => t.is_active === true));
    assert.ok(result.some((t) => t.name === "Active 1"));
    assert.ok(result.some((t) => t.name === "Active 2"));
  });

  it("returns empty array for buyer with no templates", async () => {
    const repos = makeRepos();
    const useCase = new ListTemplatesForBuyerUseCase(repos.templates);
    const result = await useCase.execute("nobody");
    assert.deepEqual(result, []);
  });

  it("does not return templates belonging to other buyers", async () => {
    const repos = makeRepos();
    const otherBuyerTemplate = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "user_2",
      merchant_id: "mrc_1",
      name: "Other's Template",
      saved_address_id: "a",
      saved_payment_method_id: "p",
      preferred_shipping_method_id: null,
    });
    await repos.templates.save(otherBuyerTemplate);

    const useCase = new ListTemplatesForBuyerUseCase(repos.templates);
    const result = await useCase.execute("user_1");
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// UpdateConsentUseCase
// ---------------------------------------------------------------------------
describe("UpdateConsentUseCase", () => {
  it("updates consent version and marketing_opt_in, fires outbox event", async () => {
    const repos = makeRepos();
    const user = BuyerUserEntity.create({
      email: "consent@t.com",
      password_hash: "h",
      consent_version: "v1",
      marketing_opt_in: false,
    });
    await repos.users.save(user);

    const useCase = new UpdateConsentUseCase(repos.users, repos.outbox);
    const result = await useCase.execute({
      buyer_user_id: user.id,
      consent_version: "v2",
      marketing_opt_in: true,
    });

    assert.deepEqual(result, { ok: true });

    const updated = await repos.users.findById(user.id);
    assert.equal(updated!.consent_version, "v2");
    assert.equal(updated!.marketing_opt_in, true);

    const events = repos.outbox.listOutbox("platform");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "buyer.consent.updated");
    assert.equal((events[0].payload as Record<string, unknown>).consent_version, "v2");
  });

  it("throws NotFoundException when buyer not found", async () => {
    const repos = makeRepos();
    const useCase = new UpdateConsentUseCase(repos.users, repos.outbox);

    await assert.rejects(
      () => useCase.execute({ buyer_user_id: "ghost", consent_version: "v1", marketing_opt_in: false }),
      { message: "BUYER_NOT_FOUND" }
    );
  });

  it("preserves other user fields when updating consent", async () => {
    const repos = makeRepos();
    const user = BuyerUserEntity.create({
      email: "keep@t.com",
      password_hash: "secret_hash",
      display_name: "John",
      consent_version: "v1",
      marketing_opt_in: false,
    });
    await repos.users.save(user);

    const useCase = new UpdateConsentUseCase(repos.users, repos.outbox);
    await useCase.execute({ buyer_user_id: user.id, consent_version: "v2", marketing_opt_in: true });

    const updated = await repos.users.findById(user.id);
    assert.equal(updated!.email, "keep@t.com");
    assert.equal(updated!.display_name, "John");
    assert.equal(updated!.password_hash, "secret_hash");
  });
});
