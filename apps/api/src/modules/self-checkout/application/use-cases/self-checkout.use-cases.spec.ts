import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RegisterBuyerUserUseCase } from "./register-buyer-user.use-case.js";
import { AddSavedAddressUseCase } from "./add-saved-address.use-case.js";
import { AddSavedPaymentMethodUseCase } from "./add-saved-payment-method.use-case.js";
import { CreateCheckoutTemplateUseCase } from "./create-checkout-template.use-case.js";
import { ExecuteCheckoutTemplateUseCase } from "./execute-checkout-template.use-case.js";
import { InMemoryBuyerUserRepository } from "../../infrastructure/repositories/in-memory-buyer-user.repository.js";
import { InMemoryBuyerWalletRepository } from "../../infrastructure/repositories/in-memory-buyer-wallet.repository.js";
import { InMemoryBuyerTemplateRepository } from "../../infrastructure/repositories/in-memory-buyer-template.repository.js";
import { StubPaymentTokenizerAdapter } from "../../infrastructure/adapters/stub-payment-tokenizer.adapter.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { CURRENT_CONSENT_VERSION } from "../../domain/policies/consent.policy.js";
import { BuyerUserEntity } from "../../domain/entities/buyer-user.entity.js";
import { BuyerWalletEntity } from "../../domain/entities/buyer-wallet.entity.js";

function makeRepos() {
  return {
    users: new InMemoryBuyerUserRepository(),
    wallets: new InMemoryBuyerWalletRepository(),
    templates: new InMemoryBuyerTemplateRepository(),
    tokenizer: new StubPaymentTokenizerAdapter(),
    outbox: new InMemoryOutboxRepository(),
  };
}

const CARD_INPUT = {
  card_number: "4111111111111111",
  expiry_month: "12",
  expiry_year: "28",
  cvv: "123",
  holder_name: "Test User",
};

describe("RegisterBuyerUserUseCase", () => {
  it("creates buyer user and wallet, fires outbox event", async () => {
    const { users, wallets, outbox } = makeRepos();
    const useCase = new RegisterBuyerUserUseCase(users, wallets, outbox);

    const result = await useCase.execute({
      email: "buyer@test.com",
      password: "hashed_password",
      marketing_opt_in: false,
    });

    assert.ok(result.user_id, "should return user_id");

    const user = await users.findById(result.user_id);
    assert.ok(user, "user should be persisted");
    assert.equal(user!.email, "buyer@test.com");

    const wallet = await wallets.findByBuyerUserId(result.user_id);
    assert.ok(wallet, "wallet should be created");

    const events = outbox.listOutbox("platform");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "buyer.registered");
  });

  it("throws ConflictException on duplicate email", async () => {
    const { users, wallets, outbox } = makeRepos();
    const useCase = new RegisterBuyerUserUseCase(users, wallets, outbox);

    await useCase.execute({ email: "dup@test.com", password: "hash", marketing_opt_in: false });
    await assert.rejects(
      () => useCase.execute({ email: "dup@test.com", password: "hash", marketing_opt_in: false }),
      { message: "EMAIL_ALREADY_REGISTERED" }
    );
  });
});

describe("AddSavedAddressUseCase", () => {
  async function setupUserAndWallet(repos: ReturnType<typeof makeRepos>) {
    const user = BuyerUserEntity.create({ email: "u@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    const wallet = BuyerWalletEntity.create(user.id);
    await repos.users.save(user);
    await repos.wallets.save(wallet);
    return user;
  }

  it("adds address to wallet and returns updated wallet snapshot", async () => {
    const repos = makeRepos();
    const user = await setupUserAndWallet(repos);
    const useCase = new AddSavedAddressUseCase(repos.users, repos.wallets);

    const snap = await useCase.execute({
      buyer_user_id: user.id,
      label: "Home",
      zip_code: "01310-100",
      street: "Av. Paulista, 1000",
      city: "São Paulo",
      state: "SP",
      country: "BR",
    });

    assert.equal(snap.saved_addresses.length, 1);
    assert.equal(snap.saved_addresses[0].state, "SP");
    assert.equal(snap.saved_addresses[0].label, "Home");
  });

  it("throws 451 when buyer has no consent", async () => {
    const repos = makeRepos();
    const user = BuyerUserEntity.create({ email: "nc@t.com", password_hash: "h", consent_version: "", marketing_opt_in: false });
    const wallet = BuyerWalletEntity.create(user.id);
    await repos.users.save(user);
    await repos.wallets.save(wallet);

    const useCase = new AddSavedAddressUseCase(repos.users, repos.wallets);
    await assert.rejects(
      () => useCase.execute({ buyer_user_id: user.id, label: "X", zip_code: "0", street: "s", city: "c", state: "SP", country: "BR" }),
      { message: "CONSENT_REQUIRED" }
    );
  });
});

describe("AddSavedPaymentMethodUseCase", () => {
  it("tokenizes card, adds to wallet, fires outbox event", async () => {
    const repos = makeRepos();
    const user = BuyerUserEntity.create({ email: "pm@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    const wallet = BuyerWalletEntity.create(user.id);
    await repos.users.save(user);
    await repos.wallets.save(wallet);

    const useCase = new AddSavedPaymentMethodUseCase(repos.users, repos.wallets, repos.tokenizer, repos.outbox);
    const result = await useCase.execute({ buyer_user_id: user.id, label: "My Visa", ...CARD_INPUT });

    assert.ok(result.method_id, "should return method_id");
    assert.equal(result.brand, "visa");
    assert.equal(result.last_four, "1111");

    const updatedWallet = await repos.wallets.findByBuyerUserId(user.id);
    assert.equal(updatedWallet!.saved_payment_methods.length, 1);

    const events = repos.outbox.listOutbox("platform");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "buyer.wallet.payment-method-added");
  });
});

describe("CreateCheckoutTemplateUseCase", () => {
  it("creates template and fires outbox event", async () => {
    const repos = makeRepos();
    const user = BuyerUserEntity.create({ email: "tpl@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    await repos.users.save(user);

    const useCase = new CreateCheckoutTemplateUseCase(repos.users, repos.templates, repos.outbox);
    const snap = await useCase.execute({
      buyer_user_id: user.id,
      merchant_id: "mrc_1",
      name: "My Template",
      saved_address_id: "addr_1",
      saved_payment_method_id: "pm_1",
    });

    assert.ok(snap.id, "template should have an id");
    assert.equal(snap.name, "My Template");
    assert.equal(snap.merchant_id, "mrc_1");

    const events = repos.outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "buyer.template.created");
  });

  it("throws NotFoundException when buyer not found", async () => {
    const repos = makeRepos();
    const useCase = new CreateCheckoutTemplateUseCase(repos.users, repos.templates, repos.outbox);
    await assert.rejects(
      () => useCase.execute({ buyer_user_id: "ghost", merchant_id: "mrc_1", name: "T", saved_address_id: "a", saved_payment_method_id: "p" }),
      { message: "BUYER_NOT_FOUND" }
    );
  });
});

describe("ExecuteCheckoutTemplateUseCase", () => {
  async function setupBuyerWithWalletAndTemplate(repos: ReturnType<typeof makeRepos>) {
    const user = BuyerUserEntity.create({ email: "exec@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    let wallet = BuyerWalletEntity.create(user.id);
    await repos.users.save(user);

    wallet = wallet.addAddress({ label: "Home", zip_code: "01310-100", street: "Av. Paulista", city: "São Paulo", state: "SP", country: "BR", is_default: true });
    const addressId = wallet.saved_addresses[0].id;

    const { wallet: walletWithPm, method } = wallet.addPaymentMethod({ label: "Visa", gateway: "asaas", gateway_token: "tok_1", last_four: "1111", brand: "visa", expires_at: new Date("2028-12-01"), is_default: true });
    wallet = walletWithPm;
    await repos.wallets.save(wallet);

    const createTemplate = new CreateCheckoutTemplateUseCase(repos.users, repos.templates, repos.outbox);
    const templateSnap = await createTemplate.execute({
      buyer_user_id: user.id,
      merchant_id: "mrc_1",
      name: "Quick Buy",
      saved_address_id: addressId,
      saved_payment_method_id: method.id,
    });

    return { user, wallet, addressId, methodId: method.id, templateId: templateSnap.id };
  }

  it("executes template and fires outbox event", async () => {
    const repos = makeRepos();
    const { user, templateId } = await setupBuyerWithWalletAndTemplate(repos);
    const useCase = new ExecuteCheckoutTemplateUseCase(repos.wallets, repos.templates, repos.outbox);

    const result = await useCase.execute({
      template_id: templateId,
      buyer_user_id: user.id,
      accepted_payment_brands: [],
      allowed_shipping_regions: [],
      items_in_stock: true,
    });

    assert.equal(result.template_id, templateId);
    assert.equal(result.address.state, "SP");
    assert.equal(result.payment_method.brand, "visa");

    const events = repos.outbox.listOutbox("mrc_1");
    const execEvent = events.find((e) => e.event_type === "buyer.template.executed");
    assert.ok(execEvent, "should fire buyer.template.executed event");
  });

  it("throws UnprocessableEntityException when payment brand not accepted", async () => {
    const repos = makeRepos();
    const { user, templateId } = await setupBuyerWithWalletAndTemplate(repos);
    const useCase = new ExecuteCheckoutTemplateUseCase(repos.wallets, repos.templates, repos.outbox);

    await assert.rejects(
      () => useCase.execute({
        template_id: templateId,
        buyer_user_id: user.id,
        accepted_payment_brands: ["mastercard"],
        allowed_shipping_regions: [],
        items_in_stock: true,
      }),
      /TEMPLATE_POLICY_VIOLATION/
    );
  });

  it("throws NotFoundException when template not found", async () => {
    const repos = makeRepos();
    const useCase = new ExecuteCheckoutTemplateUseCase(repos.wallets, repos.templates, repos.outbox);
    await assert.rejects(
      () => useCase.execute({ template_id: "ghost", buyer_user_id: "u", accepted_payment_brands: [], allowed_shipping_regions: [], items_in_stock: true }),
      { message: "TEMPLATE_NOT_FOUND" }
    );
  });
});
