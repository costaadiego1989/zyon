import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryBuyerUserRepository } from "./in-memory-buyer-user.repository.js";
import { InMemoryBuyerWalletRepository } from "./in-memory-buyer-wallet.repository.js";
import { InMemoryBuyerTemplateRepository } from "./in-memory-buyer-template.repository.js";
import { BuyerUserEntity } from "../../domain/entities/buyer-user.entity.js";
import { BuyerWalletEntity } from "../../domain/entities/buyer-wallet.entity.js";
import { BuyerCheckoutTemplateEntity } from "../../domain/entities/buyer-checkout-template.entity.js";

// ---------------------------------------------------------------------------
// InMemoryBuyerUserRepository
// ---------------------------------------------------------------------------
describe("InMemoryBuyerUserRepository", () => {
  function makeUser(email = "user@test.com") {
    return BuyerUserEntity.create({ merchant_id: "test_merchant",
      email,
      password_hash: "hash",
      consent_version: "v1",
      marketing_opt_in: false,
    });
  }

  it("save and findById round-trip", async () => {
    const repo = new InMemoryBuyerUserRepository();
    const user = makeUser();
    await repo.save(user);
    const found = await repo.findById(user.id);
    assert.ok(found);
    assert.equal(found!.id, user.id);
    assert.equal(found!.email, user.email);
  });

  it("findById returns null for non-existent id", async () => {
    const repo = new InMemoryBuyerUserRepository();
    const found = await repo.findById("ghost");
    assert.equal(found, null);
  });

  it("findByEmail returns user (case-insensitive)", async () => {
    const repo = new InMemoryBuyerUserRepository();
    const user = makeUser("Test@EXAMPLE.com");
    await repo.save(user);

    const found = await repo.findByEmail("test@example.com");
    assert.ok(found);
    assert.equal(found!.id, user.id);
  });

  it("findByEmail returns null when not found", async () => {
    const repo = new InMemoryBuyerUserRepository();
    const found = await repo.findByEmail("nobody@test.com");
    assert.equal(found, null);
  });

  it("findByEmail trims whitespace before comparing", async () => {
    const repo = new InMemoryBuyerUserRepository();
    const user = makeUser("trimmed@test.com");
    await repo.save(user);

    const found = await repo.findByEmail("  trimmed@test.com  ");
    assert.ok(found);
    assert.equal(found!.id, user.id);
  });

  it("save overwrites existing user (upsert by id)", async () => {
    const repo = new InMemoryBuyerUserRepository();
    const user = makeUser();
    await repo.save(user);
    const updated = user.updateProfile("New Name");
    await repo.save(updated);

    const found = await repo.findById(user.id);
    assert.equal(found!.display_name, "New Name");
  });
});

// ---------------------------------------------------------------------------
// InMemoryBuyerWalletRepository
// ---------------------------------------------------------------------------
describe("InMemoryBuyerWalletRepository", () => {
  it("save and findByBuyerUserId round-trip", async () => {
    const repo = new InMemoryBuyerWalletRepository();
    const wallet = BuyerWalletEntity.create("user_1");
    await repo.save(wallet);

    const found = await repo.findByBuyerUserId("user_1");
    assert.ok(found);
    assert.equal(found!.buyer_user_id, "user_1");
  });

  it("findByBuyerUserId returns null for non-existent buyer", async () => {
    const repo = new InMemoryBuyerWalletRepository();
    const found = await repo.findByBuyerUserId("ghost");
    assert.equal(found, null);
  });

  it("save overwrites wallet preserving addresses", async () => {
    const repo = new InMemoryBuyerWalletRepository();
    let wallet = BuyerWalletEntity.create("user_1");
    await repo.save(wallet);

    wallet = wallet.addAddress({ label: "Home", zip_code: "0", street: "s", city: "c", state: "SP", country: "BR", is_default: true });
    await repo.save(wallet);

    const found = await repo.findByBuyerUserId("user_1");
    assert.equal(found!.saved_addresses.length, 1);
  });

  it("isolates wallets by buyer_user_id", async () => {
    const repo = new InMemoryBuyerWalletRepository();
    const w1 = BuyerWalletEntity.create("user_1");
    const w2 = BuyerWalletEntity.create("user_2");
    await repo.save(w1);
    await repo.save(w2);

    const found = await repo.findByBuyerUserId("user_1");
    assert.equal(found!.buyer_user_id, "user_1");
    assert.notEqual(found!.id, w2.id);
  });
});

// ---------------------------------------------------------------------------
// InMemoryBuyerTemplateRepository
// ---------------------------------------------------------------------------
describe("InMemoryBuyerTemplateRepository", () => {
  function makeTemplate(buyer_user_id: string, merchant_id = "mrc_1") {
    return BuyerCheckoutTemplateEntity.create({
      buyer_user_id,
      merchant_id,
      name: "Template",
      saved_address_id: "addr_1",
      saved_payment_method_id: "pm_1",
      preferred_shipping_method_id: null,
    });
  }

  it("save and findById (with correct buyer) round-trip", async () => {
    const repo = new InMemoryBuyerTemplateRepository();
    const tmpl = makeTemplate("user_1");
    await repo.save(tmpl);

    const found = await repo.findById(tmpl.id, "user_1");
    assert.ok(found);
    assert.equal(found!.id, tmpl.id);
    assert.equal(found!.name, "Template");
  });

  it("findById returns null for wrong buyer (IDOR protection)", async () => {
    const repo = new InMemoryBuyerTemplateRepository();
    const tmpl = makeTemplate("user_1");
    await repo.save(tmpl);

    const found = await repo.findById(tmpl.id, "user_other");
    assert.equal(found, null);
  });

  it("findById returns null for non-existent id", async () => {
    const repo = new InMemoryBuyerTemplateRepository();
    const found = await repo.findById("ghost", "user_1");
    assert.equal(found, null);
  });

  it("findByBuyerUserId returns all templates for that buyer", async () => {
    const repo = new InMemoryBuyerTemplateRepository();
    const t1 = makeTemplate("user_1", "mrc_1");
    const t2 = makeTemplate("user_1", "mrc_2");
    const t3 = makeTemplate("user_2", "mrc_1");
    await repo.save(t1);
    await repo.save(t2);
    await repo.save(t3);

    const results = await repo.findByBuyerUserId("user_1");
    assert.equal(results.length, 2);
    assert.ok(results.every((t) => t.buyer_user_id === "user_1"));
  });

  it("findByBuyerUserId returns empty for unknown buyer", async () => {
    const repo = new InMemoryBuyerTemplateRepository();
    const results = await repo.findByBuyerUserId("ghost");
    assert.deepEqual(results, []);
  });

  it("save overwrites template by id", async () => {
    const repo = new InMemoryBuyerTemplateRepository();
    const tmpl = makeTemplate("user_1");
    await repo.save(tmpl);

    const updated = tmpl.update("Renamed");
    await repo.save(updated);

    const found = await repo.findById(tmpl.id, "user_1");
    assert.equal(found!.name, "Renamed");
  });
});
