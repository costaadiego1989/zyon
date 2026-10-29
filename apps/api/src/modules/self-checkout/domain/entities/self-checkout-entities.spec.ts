import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BuyerUserEntity } from "./buyer-user.entity.js";
import { BuyerWalletEntity } from "./buyer-wallet.entity.js";
import { BuyerSavedAddressEntity } from "./buyer-saved-address.entity.js";
import { BuyerSavedPaymentMethodEntity } from "./buyer-saved-payment-method.entity.js";
import { BuyerCheckoutTemplateEntity } from "./buyer-checkout-template.entity.js";

// ---------------------------------------------------------------------------
// BuyerUserEntity
// ---------------------------------------------------------------------------
describe("BuyerUserEntity", () => {
  it("creates user with all fields and generates id", () => {
    const user = BuyerUserEntity.create({
      merchant_id: "test_merchant",
      email: "buyer@test.com",
      password_hash: "scrypt:salt:hash",
      display_name: "John",
      consent_version: "v1",
      marketing_opt_in: true,
    });

    assert.ok(user.id, "should have generated id");
    assert.equal(user.email, "buyer@test.com");
    assert.equal(user.password_hash, "scrypt:salt:hash");
    assert.equal(user.display_name, "John");
    assert.equal(user.consent_version, "v1");
    assert.equal(user.marketing_opt_in, true);
    assert.ok(user.created_at instanceof Date);
    assert.ok(user.consent_updated_at instanceof Date);
  });

  it("defaults display_name to null when omitted", () => {
    const user = BuyerUserEntity.create({
      merchant_id: "test_merchant",
      email: "x@t.com",
      password_hash: "h",
      consent_version: "v1",
      marketing_opt_in: false,
    });
    assert.equal(user.display_name, null);
  });

  it("updateConsent returns new entity with updated fields", () => {
    const user = BuyerUserEntity.create({
      merchant_id: "test_merchant",
      email: "x@t.com",
      password_hash: "h",
      consent_version: "v1",
      marketing_opt_in: false,
    });

    const updated = user.updateConsent("v2", true);
    assert.equal(updated.consent_version, "v2");
    assert.equal(updated.marketing_opt_in, true);
    // Original is immutable
    assert.equal(user.consent_version, "v1");
    assert.equal(user.marketing_opt_in, false);
  });

  it("updateProfile returns new entity with updated display_name", () => {
    const user = BuyerUserEntity.create({
      merchant_id: "test_merchant",
      email: "x@t.com",
      password_hash: "h",
      consent_version: "v1",
      marketing_opt_in: false,
    });

    const updated = user.updateProfile("New Name");
    assert.equal(updated.display_name, "New Name");
    assert.equal(user.display_name, null);
  });

  it("rehydrate restores entity from snapshot", () => {
    const user = BuyerUserEntity.create({
      merchant_id: "test_merchant",
      email: "x@t.com",
      password_hash: "h",
      consent_version: "v1",
      marketing_opt_in: false,
    });
    const snap = user.snapshot();
    const restored = BuyerUserEntity.rehydrate(snap);
    assert.deepEqual(restored.snapshot(), snap);
  });

  it("snapshot returns a decoupled copy", () => {
    const user = BuyerUserEntity.create({
      merchant_id: "test_merchant",
      email: "x@t.com",
      password_hash: "h",
      consent_version: "v1",
      marketing_opt_in: false,
    });
    const s1 = user.snapshot();
    const s2 = user.snapshot();
    assert.notEqual(s1, s2);
    assert.deepEqual(s1, s2);
  });
});

// ---------------------------------------------------------------------------
// BuyerWalletEntity
// ---------------------------------------------------------------------------
describe("BuyerWalletEntity", () => {
  it("creates wallet with empty collections", () => {
    const wallet = BuyerWalletEntity.create("user_1");
    assert.ok(wallet.id);
    assert.equal(wallet.buyer_user_id, "user_1");
    assert.deepEqual(wallet.saved_addresses, []);
    assert.deepEqual(wallet.saved_payment_methods, []);
  });

  it("addAddress appends address and returns new wallet", () => {
    const wallet = BuyerWalletEntity.create("user_1");
    const updated = wallet.addAddress({
      label: "Home",
      zip_code: "01310-100",
      street: "Av. Paulista",
      city: "São Paulo",
      state: "SP",
      country: "BR",
      is_default: true,
    });

    assert.equal(updated.saved_addresses.length, 1);
    assert.equal(updated.saved_addresses[0].label, "Home");
    assert.equal(updated.saved_addresses[0].state, "SP");
    assert.equal(updated.saved_addresses[0].wallet_id, wallet.id);
    // Original unmodified
    assert.equal(wallet.saved_addresses.length, 0);
  });

  it("removeAddress filters out by id", () => {
    let wallet = BuyerWalletEntity.create("user_1");
    wallet = wallet.addAddress({ label: "A", zip_code: "0", street: "s", city: "c", state: "SP", country: "BR", is_default: false });
    wallet = wallet.addAddress({ label: "B", zip_code: "1", street: "s2", city: "c2", state: "RJ", country: "BR", is_default: false });

    const addressId = wallet.saved_addresses[0].id;
    const updated = wallet.removeAddress(addressId);

    assert.equal(updated.saved_addresses.length, 1);
    assert.equal(updated.saved_addresses[0].label, "B");
  });

  it("removeAddress with non-existent id is no-op", () => {
    let wallet = BuyerWalletEntity.create("user_1");
    wallet = wallet.addAddress({ label: "A", zip_code: "0", street: "s", city: "c", state: "SP", country: "BR", is_default: false });
    const updated = wallet.removeAddress("non_existent_id");
    assert.equal(updated.saved_addresses.length, 1);
  });

  it("addPaymentMethod appends method and returns wallet + method", () => {
    const wallet = BuyerWalletEntity.create("user_1");
    const { wallet: updated, method } = wallet.addPaymentMethod({
      label: "Visa",
      gateway: "asaas",
      gateway_token: "tok_1",
      last_four: "1111",
      brand: "visa",
      expires_at: new Date("2028-12-01"),
      is_default: false,
    });

    assert.equal(updated.saved_payment_methods.length, 1);
    assert.ok(method.id);
    assert.equal(method.brand, "visa");
    assert.equal(method.wallet_id, wallet.id);
    assert.equal(wallet.saved_payment_methods.length, 0);
  });

  it("removePaymentMethod filters out by id", () => {
    let wallet = BuyerWalletEntity.create("user_1");
    const { wallet: w1, method: m1 } = wallet.addPaymentMethod({
      label: "Visa", gateway: "asaas", gateway_token: "tok_1", last_four: "1111", brand: "visa", expires_at: new Date("2028-12-01"), is_default: false,
    });
    const { wallet: w2 } = w1.addPaymentMethod({
      label: "MC", gateway: "asaas", gateway_token: "tok_2", last_four: "2222", brand: "mastercard", expires_at: new Date("2029-06-01"), is_default: false,
    });

    const updated = w2.removePaymentMethod(m1.id);
    assert.equal(updated.saved_payment_methods.length, 1);
    assert.equal(updated.saved_payment_methods[0].brand, "mastercard");
  });

  it("rehydrate + snapshot round-trip", () => {
    let wallet = BuyerWalletEntity.create("user_1");
    wallet = wallet.addAddress({ label: "H", zip_code: "0", street: "s", city: "c", state: "SP", country: "BR", is_default: true });
    const { wallet: final } = wallet.addPaymentMethod({
      label: "V", gateway: "asaas", gateway_token: "t", last_four: "9999", brand: "visa", expires_at: new Date("2030-01-01"), is_default: true,
    });

    const snap = final.snapshot();
    const restored = BuyerWalletEntity.rehydrate(snap);
    assert.deepEqual(restored.snapshot(), snap);
  });
});

// ---------------------------------------------------------------------------
// BuyerSavedAddressEntity
// ---------------------------------------------------------------------------
describe("BuyerSavedAddressEntity", () => {
  it("creates address with generated id", () => {
    const addr = BuyerSavedAddressEntity.create({
      wallet_id: "w1",
      label: "Work",
      zip_code: "04544-000",
      street: "Rua Gomes de Carvalho",
      city: "São Paulo",
      state: "SP",
      country: "BR",
      is_default: false,
    });

    assert.ok(addr.id);
    assert.equal(addr.wallet_id, "w1");
    assert.equal(addr.label, "Work");
    assert.equal(addr.is_default, false);
  });

  it("setDefault returns new entity with updated flag", () => {
    const addr = BuyerSavedAddressEntity.create({
      wallet_id: "w1", label: "A", zip_code: "0", street: "s", city: "c", state: "SP", country: "BR", is_default: false,
    });
    const updated = addr.setDefault(true);
    assert.equal(updated.is_default, true);
    assert.equal(addr.is_default, false);
  });

  it("rehydrate restores from snapshot", () => {
    const addr = BuyerSavedAddressEntity.create({
      wallet_id: "w1", label: "A", zip_code: "0", street: "s", city: "c", state: "SP", country: "BR", is_default: true,
    });
    const snap = addr.snapshot();
    const restored = BuyerSavedAddressEntity.rehydrate(snap);
    assert.deepEqual(restored.snapshot(), snap);
  });
});

// ---------------------------------------------------------------------------
// BuyerSavedPaymentMethodEntity
// ---------------------------------------------------------------------------
describe("BuyerSavedPaymentMethodEntity", () => {
  it("creates payment method with generated id", () => {
    const pm = BuyerSavedPaymentMethodEntity.create({
      wallet_id: "w1",
      label: "My Card",
      gateway: "asaas",
      gateway_token: "tok_123",
      last_four: "4242",
      brand: "visa",
      expires_at: new Date("2028-06-01"),
      is_default: true,
    });

    assert.ok(pm.id);
    assert.equal(pm.wallet_id, "w1");
    assert.equal(pm.label, "My Card");
    assert.equal(pm.gateway, "asaas");
    assert.equal(pm.last_four, "4242");
    assert.equal(pm.brand, "visa");
    assert.equal(pm.is_default, true);
  });

  it("setDefault returns new entity with toggled flag", () => {
    const pm = BuyerSavedPaymentMethodEntity.create({
      wallet_id: "w1", label: "C", gateway: "asaas", gateway_token: "t", last_four: "0000", brand: "mastercard", expires_at: new Date("2030-01-01"), is_default: true,
    });
    const updated = pm.setDefault(false);
    assert.equal(updated.is_default, false);
    assert.equal(pm.is_default, true);
  });

  it("rehydrate restores from snapshot", () => {
    const pm = BuyerSavedPaymentMethodEntity.create({
      wallet_id: "w1", label: "C", gateway: "asaas", gateway_token: "t", last_four: "5555", brand: "visa", expires_at: new Date("2027-03-01"), is_default: false,
    });
    const snap = pm.snapshot();
    const restored = BuyerSavedPaymentMethodEntity.rehydrate(snap);
    assert.deepEqual(restored.snapshot(), snap);
  });
});

// ---------------------------------------------------------------------------
// BuyerCheckoutTemplateEntity
// ---------------------------------------------------------------------------
describe("BuyerCheckoutTemplateEntity", () => {
  it("creates template with generated id and is_active=true", () => {
    const tmpl = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "u1",
      merchant_id: "mrc_1",
      name: "Quick Buy",
      saved_address_id: "addr_1",
      saved_payment_method_id: "pm_1",
      preferred_shipping_method_id: "ship_1",
    });

    assert.ok(tmpl.id);
    assert.equal(tmpl.buyer_user_id, "u1");
    assert.equal(tmpl.merchant_id, "mrc_1");
    assert.equal(tmpl.name, "Quick Buy");
    assert.equal(tmpl.saved_address_id, "addr_1");
    assert.equal(tmpl.saved_payment_method_id, "pm_1");
    assert.equal(tmpl.preferred_shipping_method_id, "ship_1");
    assert.equal(tmpl.is_active, true);
    assert.ok(tmpl.created_at instanceof Date);
  });

  it("creates template with null preferred_shipping_method_id", () => {
    const tmpl = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "u1",
      merchant_id: "mrc_1",
      name: "Default",
      saved_address_id: "addr_1",
      saved_payment_method_id: "pm_1",
      preferred_shipping_method_id: null,
    });
    assert.equal(tmpl.preferred_shipping_method_id, null);
  });

  it("deactivate returns new entity with is_active=false", () => {
    const tmpl = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "u1", merchant_id: "mrc_1", name: "T", saved_address_id: "a", saved_payment_method_id: "p", preferred_shipping_method_id: null,
    });
    const deactivated = tmpl.deactivate();
    assert.equal(deactivated.is_active, false);
    assert.equal(tmpl.is_active, true);
  });

  it("update returns new entity with updated name", () => {
    const tmpl = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "u1", merchant_id: "mrc_1", name: "Old", saved_address_id: "a", saved_payment_method_id: "p", preferred_shipping_method_id: null,
    });
    const updated = tmpl.update("New Name");
    assert.equal(updated.name, "New Name");
    assert.equal(tmpl.name, "Old");
  });

  it("rehydrate + snapshot round-trip", () => {
    const tmpl = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: "u1", merchant_id: "mrc_1", name: "T", saved_address_id: "a", saved_payment_method_id: "p", preferred_shipping_method_id: "s",
    });
    const snap = tmpl.snapshot();
    const restored = BuyerCheckoutTemplateEntity.rehydrate(snap);
    assert.deepEqual(restored.snapshot(), snap);
  });
});
