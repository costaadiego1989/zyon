import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BuyerMeController } from "./buyer-me.controller.js";
import { AddSavedAddressUseCase } from "../../application/use-cases/add-saved-address.use-case.js";
import { RemoveSavedAddressUseCase } from "../../application/use-cases/remove-saved-address.use-case.js";
import { AddSavedPaymentMethodUseCase } from "../../application/use-cases/add-saved-payment-method.use-case.js";
import { DeleteSavedPaymentMethodUseCase } from "../../application/use-cases/delete-saved-payment-method.use-case.js";
import { CreateCheckoutTemplateUseCase } from "../../application/use-cases/create-checkout-template.use-case.js";
import { ExecuteCheckoutTemplateUseCase } from "../../application/use-cases/execute-checkout-template.use-case.js";
import { ListTemplatesForBuyerUseCase } from "../../application/use-cases/list-templates-for-buyer.use-case.js";
import { UpdateConsentUseCase } from "../../application/use-cases/update-consent.use-case.js";
import { InMemoryBuyerUserRepository } from "../../infrastructure/repositories/in-memory-buyer-user.repository.js";
import { InMemoryBuyerWalletRepository } from "../../infrastructure/repositories/in-memory-buyer-wallet.repository.js";
import { InMemoryBuyerTemplateRepository } from "../../infrastructure/repositories/in-memory-buyer-template.repository.js";
import { StubPaymentTokenizerAdapter } from "../../infrastructure/adapters/stub-payment-tokenizer.adapter.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { BuyerUserEntity } from "../../domain/entities/buyer-user.entity.js";
import { BuyerWalletEntity } from "../../domain/entities/buyer-wallet.entity.js";
import { CURRENT_CONSENT_VERSION } from "../../domain/policies/consent.policy.js";

function makeRepos() {
  return {
    users: new InMemoryBuyerUserRepository(),
    wallets: new InMemoryBuyerWalletRepository(),
    templates: new InMemoryBuyerTemplateRepository(),
    tokenizer: new StubPaymentTokenizerAdapter(),
    outbox: new InMemoryOutboxRepository(),
  };
}

function makeController(repos: ReturnType<typeof makeRepos>) {
  return new BuyerMeController(
    new AddSavedAddressUseCase(repos.users, repos.wallets),
    new RemoveSavedAddressUseCase(repos.wallets),
    new AddSavedPaymentMethodUseCase(repos.users, repos.wallets, repos.outbox),
    new DeleteSavedPaymentMethodUseCase(repos.wallets),
    new CreateCheckoutTemplateUseCase(repos.users, repos.wallets, repos.templates, repos.outbox),
    new ExecuteCheckoutTemplateUseCase(repos.wallets, repos.templates, repos.outbox),
    new ListTemplatesForBuyerUseCase(repos.templates),
    new UpdateConsentUseCase(repos.users, repos.outbox),
    repos.wallets,
    repos.tokenizer,
  );
}

async function setupBuyer(repos: ReturnType<typeof makeRepos>) {
  const user = BuyerUserEntity.create({
    email: "me@test.com",
    password_hash: "hash",
    consent_version: CURRENT_CONSENT_VERSION,
    marketing_opt_in: false,
  });
  const wallet = BuyerWalletEntity.create(user.id);
  await repos.users.save(user);
  await repos.wallets.save(wallet);
  return { user, req: { buyer: { sub: user.id, email: user.email, aud: "buyer.aacp", exp: 9999999999 } } };
}

describe("BuyerMeController", () => {
  it("getAddresses returns empty array for new wallet", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);
    const { req } = await setupBuyer(repos);

    const result = await controller.getAddresses(req);
    assert.deepEqual(result, []);
  });

  it("addAddr creates address and getAddresses returns it", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);
    const { req } = await setupBuyer(repos);

    await controller.addAddr(req, {
      label: "Home",
      zip_code: "01310-100",
      street: "Av. Paulista",
      city: "São Paulo",
      state: "SP",
      country: "BR",
    });

    const addresses = await controller.getAddresses(req);
    assert.equal(addresses.length, 1);
    assert.equal(addresses[0].label, "Home");
  });

  it("removeAddr deletes an address", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);
    const { req } = await setupBuyer(repos);

    await controller.addAddr(req, {
      label: "To Delete",
      zip_code: "0",
      street: "s",
      city: "c",
      state: "SP",
      country: "BR",
    });
    const addresses = await controller.getAddresses(req);
    const addrId = addresses[0].id;

    await controller.removeAddr(req, addrId);
    const after = await controller.getAddresses(req);
    assert.equal(after.length, 0);
  });

  it("getPaymentMethods returns empty for new wallet", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);
    const { req } = await setupBuyer(repos);

    const result = await controller.getPaymentMethods(req);
    assert.deepEqual(result, []);
  });

  it("addMethod tokenizes at edge and adds payment method", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);
    const { req } = await setupBuyer(repos);

    const result = await controller.addMethod(req, {
      card_number: "4111111111111111",
      expiry_month: "12",
      expiry_year: "28",
      cvv: "123",
      holder_name: "Test User",
      label: "My Visa",
    });

    assert.ok(result.method_id);
    assert.equal(result.brand, "visa");
    assert.equal(result.last_four, "1111");

    const methods = await controller.getPaymentMethods(req);
    assert.equal(methods.length, 1);
    assert.equal(methods[0].brand, "visa");
  });

  it("deleteMethod removes payment method", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);
    const { req } = await setupBuyer(repos);

    const added = await controller.addMethod(req, {
      card_number: "5200000000001234",
      expiry_month: "06",
      expiry_year: "30",
      cvv: "000",
      holder_name: "Test",
      label: "MC",
    });

    await controller.deleteMethod(req, added.method_id);
    const methods = await controller.getPaymentMethods(req);
    assert.equal(methods.length, 0);
  });

  it("full template lifecycle: create, list, execute", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);
    const { req } = await setupBuyer(repos);

    // Add address and payment method first
    await controller.addAddr(req, {
      label: "Home", zip_code: "01310-100", street: "Av. Paulista", city: "São Paulo", state: "SP", country: "BR",
    });
    await controller.addMethod(req, {
      card_number: "4111111111111111", expiry_month: "12", expiry_year: "28", cvv: "123", holder_name: "T", label: "V",
    });

    const addresses = await controller.getAddresses(req);
    const methods = await controller.getPaymentMethods(req);

    // Create template
    const tmpl = await controller.createTmpl(req, {
      merchant_id: "mrc_1",
      name: "Quick Buy",
      saved_address_id: addresses[0].id,
      saved_payment_method_id: methods[0].id,
    });
    assert.ok(tmpl.id);
    assert.equal(tmpl.name, "Quick Buy");

    // List templates
    const list = await controller.getTemplates(req);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Quick Buy");

    // Execute template
    const exec = await controller.executeTmpl(req, tmpl.id, {
      accepted_payment_brands: [],
      allowed_shipping_regions: [],
      items_in_stock: true,
    });
    assert.equal(exec.template_id, tmpl.id);
    assert.equal(exec.address.state, "SP");
    assert.equal(exec.payment_method.brand, "visa");
  });

  it("consent endpoint updates consent version", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);
    const { req } = await setupBuyer(repos);

    const result = await controller.consent(req, {
      consent_version: "v2",
      marketing_opt_in: true,
    });
    assert.deepEqual(result, { ok: true });
  });

  it("enforces tenant boundary: buyer A cannot access buyer B resources", async () => {
    const repos = makeRepos();
    const controller = makeController(repos);

    // Setup buyer A
    const userA = BuyerUserEntity.create({ email: "a@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    let walletA = BuyerWalletEntity.create(userA.id);
    walletA = walletA.addAddress({ label: "A's Addr", zip_code: "0", street: "s", city: "c", state: "SP", country: "BR", is_default: true });
    await repos.users.save(userA);
    await repos.wallets.save(walletA);

    // Setup buyer B
    const userB = BuyerUserEntity.create({ email: "b@t.com", password_hash: "h", consent_version: CURRENT_CONSENT_VERSION, marketing_opt_in: false });
    const walletB = BuyerWalletEntity.create(userB.id);
    await repos.users.save(userB);
    await repos.wallets.save(walletB);

    const reqB = { buyer: { sub: userB.id, email: userB.email, aud: "buyer.aacp", exp: 9999999999 } };

    // Buyer B sees empty wallet, not buyer A's data
    const addresses = await controller.getAddresses(reqB);
    assert.equal(addresses.length, 0);
  });
});
