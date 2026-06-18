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

// ---------------------------------------------------------------------------
// RegisterBuyerUserUseCase
// ---------------------------------------------------------------------------
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
    // P2 regression: email stored lowercase
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

  // P2 regression: email case-insensitive dedup
  it("rejects duplicate email regardless of casing", async () => {
    const { users, wallets, outbox } = makeRepos();
    const useCase = new RegisterBuyerUserUseCase(users, wallets, outbox);

    await useCase.execute({ email: "Test@example.com", password: "hash", marketing_opt_in: false });

    // Same address, different case → must be rejected
    await assert.rejects(
      () => useCase.execute({ email: "test@EXAMPLE.COM", password: "hash2", marketing_opt_in: false }),
      { message: "EMAIL_ALREADY_REGISTERED" }
    );
  });

  // P2 regression: email stored normalised (lowercase)
  it("stores email in lowercase", async () => {
    const { users, wallets, outbox } = makeRepos();
    const useCase = new RegisterBuyerUserUseCase(users, wallets, outbox);

    const { user_id } = await useCase.execute({ email: "  UPPER@Example.com  ", password: "hash", marketing_opt_in: false });
    const stored = await users.findById(user_id);
    assert.equal(stored!.email, "upper@example.com");
  });
});

// ---------------------------------------------------------------------------
// AddSavedAddressUseCase
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// AddSavedPaymentMethodUseCase
// P2 PCI fix: use-case now receives a pre-tokenized token; no raw card data.
// ---------------------------------------------------------------------------
describe("AddSavedPaymentMethodUseCase", () => {
  async function setupUserWalletAndToken(repos: ReturnType<typeof makeRepos>) {
    const user = BuyerUserEntity.create({ email: "pm@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    const wallet = BuyerWalletEntity.create(user.id);
    await repos.users.save(user);
    await repos.wallets.save(wallet);
    // Tokenize at the edge (simulating what the controller does)
    const token = await repos.tokenizer.tokenize({
      card_number: "4111111111111111",
      expiry_month: "12",
      expiry_year: "28",
      cvv: "123",
      holder_name: "Test User",
    });
    return { user, token };
  }

  it("adds pre-tokenized method to wallet, fires outbox event", async () => {
    const repos = makeRepos();
    const { user, token } = await setupUserWalletAndToken(repos);

    // P2 PCI fix: no raw card data in use-case input
    const useCase = new AddSavedPaymentMethodUseCase(repos.users, repos.wallets, repos.outbox);
    const result = await useCase.execute({ buyer_user_id: user.id, label: "My Visa", token });

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

// ---------------------------------------------------------------------------
// StubPaymentTokenizerAdapter — P3 expiry date fix
// ---------------------------------------------------------------------------
describe("StubPaymentTokenizerAdapter", () => {
  const tokenizer = new StubPaymentTokenizerAdapter();

  it("produces valid Date from zero-padded month", async () => {
    const result = await tokenizer.tokenize({
      card_number: "4111111111111111",
      expiry_month: "03",
      expiry_year: "28",
      cvv: "123",
      holder_name: "Test",
    });
    assert.ok(!isNaN(result.expires_at.getTime()), "expires_at must be a valid Date");
    assert.equal(result.expires_at.getUTCFullYear(), 2028);
    assert.equal(result.expires_at.getUTCMonth(), 2); // 0-based → March
  });

  // P3 regression: non-padded single-digit month must not produce Invalid Date
  it("produces valid Date from non-zero-padded month '3'", async () => {
    const result = await tokenizer.tokenize({
      card_number: "4111111111111111",
      expiry_month: "3",
      expiry_year: "28",
      cvv: "123",
      holder_name: "Test",
    });
    assert.ok(!isNaN(result.expires_at.getTime()), "expires_at must be valid for single-digit month");
    assert.equal(result.expires_at.getUTCMonth(), 2); // March (0-based)
    assert.equal(result.expires_at.getUTCFullYear(), 2028);
  });

  it("throws on invalid expiry month", async () => {
    await assert.rejects(
      () => tokenizer.tokenize({ card_number: "4111111111111111", expiry_month: "13", expiry_year: "28", cvv: "123", holder_name: "T" }),
      /invalid_card_expiry/
    );
  });

  it("produces correct last_four and brand", async () => {
    const result = await tokenizer.tokenize({
      card_number: "5200000000001234",
      expiry_month: "01",
      expiry_year: "30",
      cvv: "000",
      holder_name: "Test",
    });
    assert.equal(result.last_four, "1234");
    assert.equal(result.brand, "mastercard");
  });
});

// ---------------------------------------------------------------------------
// CreateCheckoutTemplateUseCase
// P1 fix: validates address/method ownership against buyer's wallet
// ---------------------------------------------------------------------------
describe("CreateCheckoutTemplateUseCase", () => {
  async function setupUserWithWallet(repos: ReturnType<typeof makeRepos>) {
    const user = BuyerUserEntity.create({ email: "tpl@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    let wallet = BuyerWalletEntity.create(user.id);
    await repos.users.save(user);
    wallet = wallet.addAddress({ label: "Home", zip_code: "01310-100", street: "Av. Paulista", city: "São Paulo", state: "SP", country: "BR", is_default: true });
    const addressId = wallet.saved_addresses[0].id;
    const { wallet: walletWithPm, method } = wallet.addPaymentMethod({ label: "Visa", gateway: "asaas", gateway_token: "tok_1", last_four: "1111", brand: "visa", expires_at: new Date("2028-12-01"), is_default: true });
    await repos.wallets.save(walletWithPm);
    return { user, addressId, methodId: method.id };
  }

  it("creates template when address and method are in buyer's wallet", async () => {
    const repos = makeRepos();
    const { user, addressId, methodId } = await setupUserWithWallet(repos);
    const useCase = new CreateCheckoutTemplateUseCase(repos.users, repos.wallets, repos.templates, repos.outbox);

    const snap = await useCase.execute({
      buyer_user_id: user.id,
      merchant_id: "mrc_1",
      name: "My Template",
      saved_address_id: addressId,
      saved_payment_method_id: methodId,
    });

    assert.ok(snap.id, "template should have an id");
    assert.equal(snap.name, "My Template");
    assert.equal(snap.merchant_id, "mrc_1");

    const events = repos.outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "buyer.template.created");
  });

  // P1 regression: must reject when saved_address_id is not in buyer's wallet
  it("throws UnprocessableEntityException when address_id is not in buyer's wallet", async () => {
    const repos = makeRepos();
    const { user, methodId } = await setupUserWithWallet(repos);
    const useCase = new CreateCheckoutTemplateUseCase(repos.users, repos.wallets, repos.templates, repos.outbox);

    await assert.rejects(
      () => useCase.execute({
        buyer_user_id: user.id,
        merchant_id: "mrc_1",
        name: "Bad Template",
        saved_address_id: "addr_not_mine",
        saved_payment_method_id: methodId,
      }),
      { message: "ADDRESS_NOT_IN_WALLET" }
    );
  });

  // P1 regression: must reject when saved_payment_method_id is not in buyer's wallet
  it("throws UnprocessableEntityException when payment_method_id is not in buyer's wallet", async () => {
    const repos = makeRepos();
    const { user, addressId } = await setupUserWithWallet(repos);
    const useCase = new CreateCheckoutTemplateUseCase(repos.users, repos.wallets, repos.templates, repos.outbox);

    await assert.rejects(
      () => useCase.execute({
        buyer_user_id: user.id,
        merchant_id: "mrc_1",
        name: "Bad Template",
        saved_address_id: addressId,
        saved_payment_method_id: "pm_not_mine",
      }),
      { message: "PAYMENT_METHOD_NOT_IN_WALLET" }
    );
  });

  it("throws NotFoundException when buyer not found", async () => {
    const repos = makeRepos();
    const useCase = new CreateCheckoutTemplateUseCase(repos.users, repos.wallets, repos.templates, repos.outbox);
    await assert.rejects(
      () => useCase.execute({ buyer_user_id: "ghost", merchant_id: "mrc_1", name: "T", saved_address_id: "a", saved_payment_method_id: "p" }),
      { message: "BUYER_NOT_FOUND" }
    );
  });
});

// ---------------------------------------------------------------------------
// ExecuteCheckoutTemplateUseCase
// P0 fix: findById scoped by buyer_user_id → IDOR impossible
// ---------------------------------------------------------------------------
describe("ExecuteCheckoutTemplateUseCase", () => {
  async function setupBuyerWithWalletAndTemplate(repos: ReturnType<typeof makeRepos>, email = "exec@t.com") {
    const user = BuyerUserEntity.create({ email, password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    let wallet = BuyerWalletEntity.create(user.id);
    await repos.users.save(user);

    wallet = wallet.addAddress({ label: "Home", zip_code: "01310-100", street: "Av. Paulista", city: "São Paulo", state: "SP", country: "BR", is_default: true });
    const addressId = wallet.saved_addresses[0].id;

    const { wallet: walletWithPm, method } = wallet.addPaymentMethod({ label: "Visa", gateway: "asaas", gateway_token: "tok_1", last_four: "1111", brand: "visa", expires_at: new Date("2028-12-01"), is_default: true });
    wallet = walletWithPm;
    await repos.wallets.save(wallet);

    const createTemplate = new CreateCheckoutTemplateUseCase(repos.users, repos.wallets, repos.templates, repos.outbox);
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

  // P0 regression: buyer B must not be able to execute buyer A's template
  it("returns TEMPLATE_NOT_FOUND when buyer_user_id does not own the template (IDOR guard)", async () => {
    const repos = makeRepos();
    // Buyer A creates a template
    const { templateId } = await setupBuyerWithWalletAndTemplate(repos, "buyer-a@t.com");

    // Buyer B exists but has a different wallet — no access to A's template
    const buyerB = BuyerUserEntity.create({ email: "buyer-b@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    await repos.users.save(buyerB);
    await repos.wallets.save(BuyerWalletEntity.create(buyerB.id));

    const useCase = new ExecuteCheckoutTemplateUseCase(repos.wallets, repos.templates, repos.outbox);

    // Buyer B passes A's template_id → must get 404, not A's template data
    await assert.rejects(
      () => useCase.execute({
        template_id: templateId,
        buyer_user_id: buyerB.id,
        accepted_payment_brands: [],
        allowed_shipping_regions: [],
        items_in_stock: true,
      }),
      { message: "TEMPLATE_NOT_FOUND" }
    );
  });
});
