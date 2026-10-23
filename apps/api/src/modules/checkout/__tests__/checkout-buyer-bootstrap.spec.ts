import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutSession, StartCheckoutRequest } from "@zyon/shared-types";
import type { BuyerAccountRepository } from "../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { BuyerAccount } from "../../buyer-account/domain/entities/buyer-account.entity.js";
import { BuyerRecognitionService } from "../application/services/buyer-recognition.service.js";
import { BuyerAccountPersistenceService } from "../application/services/buyer-account-persistence.service.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { CheckoutBootstrapService } from "../application/services/checkout-bootstrap.service.js";
import type { TrustedCheckoutBuyer } from "../application/services/trusted-checkout-buyer.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "./checkout-test-fixtures.js";

const merchantId = "synthetic-bootstrap-merchant", sessionId = "synthetic-bootstrap-checkout";
const email = "buyer@example.test", buyerId = "synthetic-bootstrap-buyer";
const proof = (): TrustedCheckoutBuyer => ({ globalUserId: buyerId, customer: { email, email_verified: true } });
const input = (): StartCheckoutRequest => ({ merchant_id: merchantId, session_id: sessionId,
  customer: proof().customer, cart: { currency: "BRL", source: "storefront", cart_ref: "synthetic-cart",
    total: 20, currentDiscount: 1, items: [{ sku: "sku", quantity: 1, price: 20, cost: 10, name: "Produto" }] } });
const account = (id = buyerId) => new BuyerAccount({ globalUserId: id, email, passwordHash: "synthetic-hash",
  displayName: "Comprador sintético", cpf: "12345678900", phone: "11999999999",
  address: { zip: "01001000", street: "Rua de teste", number: "1", complement: "", city: "São Paulo", state: "SP" },
  createdAt: new Date(0), updatedAt: new Date(0) });

function fixture() {
  const calls: string[] = [], inserted: CheckoutSession[] = [], accountWrites: BuyerAccount[] = [];
  const repo = new InMemoryCheckoutRepository();
  const create = repo.createSessionIfAbsent.bind(repo), save = repo.saveSession.bind(repo);
  const mutation = repo.commitCommercialMutation.bind(repo);
  repo.createSessionIfAbsent = session => { calls.push("create"); inserted.push(structuredClone(session)); return create(session); };
  repo.saveSession = session => { calls.push("save"); save(session); };
  repo.commitCommercialMutation = value => { calls.push("commercial-mutation"); return mutation(value); };
  let found: BuyerAccount | null = account(), readError: Error | undefined;
  const accounts: BuyerAccountRepository = {
    async findByEmail(value) { calls.push("account-read"); assert.equal(value, email); if (readError) throw readError; return found; },
    async save(value) { calls.push("account-write"); accountWrites.push(value); },
    async findByPhone() { assert.fail("unexpected phone lookup"); },
    async findByGlobalUserId() { assert.fail("unexpected identity lookup"); },
    async findAgentByGlobalUserId() { assert.fail("unexpected agent lookup"); },
    async saveAgent() { assert.fail("unexpected agent write"); },
    async findM2mByTokenHash() { assert.fail("unexpected m2m lookup"); },
  };
  const recognition = new BuyerRecognitionService(repo, accounts);
  const persistence = new BuyerAccountPersistenceService(accounts);
  const customer = new CheckoutCustomerService(repo, undefined, undefined, recognition, persistence);
  const bootstrap = new CheckoutBootstrapService(repo, repo, customer);
  const run = () => bootstrap.bootstrap(input(), buyerId, true, { trustedBuyer: proof(), requireBuyerProof: true });
  return { repo, customer, persistence, bootstrap, run, calls, inserted, accountWrites,
    getAccount() { return found; },
    setAccount(value: BuyerAccount | null) { found = value; }, failRead(value: Error) { readError = value; } };
}

test("first atomic checkout insertion already contains the authenticated returning profile", async () => {
  const f = fixture(); const request = input(), before = structuredClone(request);
  const result = await f.bootstrap.bootstrap(request, buyerId, true, { trustedBuyer: proof(), requireBuyerProof: true });
  assert.equal(f.inserted.length, 1);
  assert.equal(f.inserted[0].customer?.cpf, account().cpf);
  assert.equal(f.inserted[0].customer?.address?.street, "Rua de teste");
  assert.equal(f.inserted[0].globalUserId, buyerId);
  assert.ok(f.calls.indexOf("account-read") < f.calls.indexOf("create"));
  assert.equal(f.calls.includes("commercial-mutation"), false);
  assert.equal(result.session.cart.currentDiscount, 1);
  assert.deepEqual(result.session.cart, before.cart);
  assert.equal(result.session.cohort, "treatment");
  assert.deepEqual(request, before, "read-only preparation must not mutate caller data");
  assert.equal(f.accountWrites.length, 1);
  assert.ok(f.calls.lastIndexOf("save") < f.calls.indexOf("account-write"));
});

test("recognition storage failure happens before any checkout/account/outbox write", async () => {
  const f = fixture(); f.failRead(new Error("synthetic-storage-unavailable"));
  await assert.rejects(f.run(), /synthetic-storage-unavailable/);
  assert.equal(f.inserted.length, 0); assert.equal(f.calls.includes("save"), false);
  assert.equal(f.accountWrites.length, 0); assert.equal(f.repo.listOutbox(merchantId).length, 0);
  assert.equal(f.repo.getSession(merchantId, sessionId), undefined);
});

test("a recognized account cannot replace the signed buyer identity before or after insert", async () => {
  const f = fixture(); f.setAccount(account("other-buyer"));
  await assert.rejects(f.run(), /checkout_buyer_session_binding_mismatch/);
  assert.equal(f.inserted.length, 0); assert.equal(f.accountWrites.length, 0);
  assert.equal(f.repo.getSession(merchantId, sessionId), undefined);
  assert.equal(f.repo.listOutbox(merchantId).length, 0);
});

for (const field of ["globalUserId", "email", "verified"] as const) {
  test(`invalid internal candidate ${field} fails before recognizing private profile`, async () => {
    const f = fixture(); const request = input();
    if (field === "email") request.customer = { email: "other@example.test", email_verified: true };
    if (field === "verified") request.customer = { email, email_verified: false };
    await assert.rejects(f.bootstrap.bootstrap(request, field === "globalUserId" ? "other-buyer" : buyerId,
      true, { trustedBuyer: proof(), requireBuyerProof: true }), /checkout_buyer_session_binding_mismatch/);
    assert.equal(f.calls.includes("account-read"), false); assert.equal(f.inserted.length, 0);
    assert.equal(f.accountWrites.length, 0);
  });
}

test("an unverified email hint never triggers returning-profile lookup or account writes", async () => {
  const f = fixture(); const request = input(); request.customer = { email };
  const result = await f.bootstrap.bootstrap(request, "synthetic-anonymous", true);
  assert.deepEqual(result.session.customer, { email }); assert.equal(result.session.globalUserId, "synthetic-anonymous");
  assert.equal(f.calls.includes("account-read"), false); assert.equal(f.accountWrites.length, 0);
});

test("a new verified buyer without prior account/profile retains the signed identity", async () => {
  const f = fixture(); f.setAccount(null);
  const result = await f.run();
  assert.equal(result.session.globalUserId, buyerId); assert.equal(result.session.customer?.cpf, undefined);
  assert.equal(f.inserted[0].globalUserId, buyerId); assert.equal(f.accountWrites.length, 0);
  assert.equal(f.calls.includes("commercial-mutation"), false);
});

test("resuming an authenticated checkout hydrates only its canonical session without commercial mutation", async () => {
  const f = fixture(); const existing = checkoutSession({ merchantId, sessionId, globalUserId: buyerId,
    customer: proof().customer, cart: input().cart, cohort: "holdout" });
  f.repo.saveSession(existing); f.calls.length = 0;
  const result = await f.run();
  assert.equal(f.inserted.length, 0); assert.equal(result.session.customer?.cpf, account().cpf);
  assert.equal(result.session.cohort, "holdout"); assert.equal(result.session.conversationId, existing.conversationId);
  assert.equal(f.calls.includes("commercial-mutation"), false);
});

test("another buyer's canonical checkout is rejected before private-profile lookup", async () => {
  const f = fixture(); const existing = checkoutSession({ merchantId, sessionId, globalUserId: "other-buyer",
    customer: { email: "other@example.test", email_verified: true }, cart: input().cart });
  f.repo.saveSession(existing); f.calls.length = 0;
  await assert.rejects(f.run(), /checkout_buyer_session_binding_mismatch/);
  assert.equal(f.calls.includes("account-read"), false); assert.equal(f.calls.includes("save"), false);
  assert.deepEqual(f.repo.getSession(merchantId, sessionId), existing); assert.equal(f.accountWrites.length, 0);
});

for (const sameBuyer of [true, false]) {
  test(`create-if-absent loser uses only the canonical winner (${sameBuyer ? "same" : "different"} buyer)`, async () => {
    const f = fixture(); const winner = checkoutSession({ merchantId, sessionId,
      globalUserId: sameBuyer ? buyerId : "other-buyer", cart: { ...input().cart, total: 40,
        items: [{ ...input().cart.items[0], quantity: 2 }] },
      customer: { email: sameBuyer ? email : "other@example.test", email_verified: true, fullName: "Perfil vencedor" },
      conversationId: "synthetic-winner-conversation", cohort: "holdout" });
    f.repo.createSessionIfAbsent = candidate => {
      f.inserted.push(structuredClone(candidate)); f.repo.saveSession(winner);
      return { created: false, session: structuredClone(winner) };
    };
    if (!sameBuyer) {
      await assert.rejects(f.run(), /checkout_buyer_session_binding_mismatch/);
      assert.deepEqual(f.repo.getSession(merchantId, sessionId), winner); assert.equal(f.accountWrites.length, 0);
    } else {
      const result = await f.run(); assert.equal(result.session.customer?.fullName, "Perfil vencedor");
      assert.deepEqual(result.session.cart, winner.cart); assert.equal(result.session.conversationId, winner.conversationId);
      assert.equal(result.session.cohort, "holdout"); assert.equal(f.accountWrites[0]?.displayName, "Perfil vencedor");
    }
    assert.equal(f.calls.includes("commercial-mutation"), false);
  });
}

test("trusted preparation is detached and performs no persistence", async () => {
  const f = fixture(); const candidate = checkoutSession({ merchantId, sessionId, globalUserId: buyerId,
    customer: proof().customer, cart: input().cart }); const before = structuredClone(candidate);
  const prepared = await f.customer.prepareTrustedBuyerForCheckout(candidate, proof());
  assert.equal(prepared.customer?.cpf, account().cpf); assert.deepEqual(candidate, before);
  prepared.cart.items[0].name = "mutated"; prepared.customer!.address!.street = "mutated";
  assert.deepEqual(candidate, before); assert.equal(f.getAccount()?.address?.street, "Rua de teste");
  assert.equal(f.calls.includes("save"), false); assert.equal(f.accountWrites.length, 0);
  assert.equal(f.calls.includes("commercial-mutation"), false);
});

test("account changed between preparation and account persistence never receives this buyer's profile", async () => {
  const f = fixture(); const save = f.repo.saveSession.bind(f.repo);
  f.repo.saveSession = value => { save(value); if (value.customer?.cpf) f.setAccount(account("other-buyer")); };
  await assert.rejects(f.run(), /checkout_buyer_session_binding_mismatch/);
  assert.equal(f.accountWrites.length, 0); assert.equal(f.repo.listOutbox(merchantId).length, 0);
});

test("failed canonical save never persists a prepared buyer profile or emits a start fact", async () => {
  const f = fixture(); const save = f.repo.saveSession.bind(f.repo);
  let writes = 0;
  f.repo.saveSession = value => { writes += 1; if (writes > 1) throw new Error("synthetic-save-failed"); save(value); };
  await assert.rejects(f.run(), /synthetic-save-failed/);
  assert.equal(f.accountWrites.length, 0); assert.equal(f.repo.listOutbox(merchantId).length, 0);
  assert.equal(f.repo.getSession(merchantId, sessionId)?.globalUserId, buyerId);
});

test("matching verified prior session can hydrate a buyer without an account", async () => {
  const f = fixture(); f.setAccount(null);
  f.repo.saveSession(checkoutSession({ merchantId, sessionId: "synthetic-prior", globalUserId: buyerId,
    customer: { ...proof().customer, fullName: "Perfil anterior", cpf: account().cpf, phone: account().phone } }));
  const result = await f.run();
  assert.equal(f.inserted[0].customer?.fullName, "Perfil anterior");
  assert.equal(result.session.globalUserId, buyerId); assert.equal(f.accountWrites[0]?.globalUserId, buyerId);
  assert.equal(f.calls.includes("commercial-mutation"), false);
});

test("a conflicting prior session is ignored rather than adopted as the signed buyer", async () => {
  const f = fixture(); f.setAccount(null);
  f.repo.saveSession(checkoutSession({ merchantId, sessionId: "synthetic-prior", globalUserId: "other-buyer",
    customer: { ...proof().customer, fullName: "Outro comprador", cpf: account().cpf } }));
  f.calls.length = 0;
  const result = await f.run();
  assert.equal(result.session.globalUserId, buyerId); assert.equal(result.session.customer?.cpf, undefined);
  assert.equal(result.session.customer?.fullName, undefined); assert.equal(f.accountWrites.length, 0);
});

test("same email in another merchant's checkout does not supply a previous profile", async () => {
  const f = fixture(); f.setAccount(null);
  f.repo.saveSession(checkoutSession({ merchantId: "other-merchant", sessionId: "synthetic-prior", globalUserId: buyerId,
    customer: { ...proof().customer, fullName: "Dados de outra loja", cpf: account().cpf } }));
  const result = await f.run();
  assert.equal(result.session.customer?.fullName, undefined); assert.equal(result.session.customer?.cpf, undefined);
  assert.equal(f.accountWrites.length, 0);
});

test("a scoped account write rejects a session whose buyer identity changed", async () => {
  const f = fixture();
  await assert.rejects(f.persistence.ensureBuyerAccountPersisted(checkoutSession({ merchantId, sessionId,
    globalUserId: "other-buyer", customer: { ...proof().customer, fullName: "Novo perfil", cpf: account().cpf, phone: account().phone } }),
  false, buyerId), /checkout_buyer_session_binding_mismatch/);
  assert.equal(f.calls.includes("account-read"), false); assert.equal(f.accountWrites.length, 0);
});

test("cart refresh CAS uses the persisted snapshot, not a newly hydrated expected profile", async () => {
  const f = fixture(); const existing = checkoutSession({ merchantId, sessionId, globalUserId: buyerId,
    customer: proof().customer, cart: input().cart });
  f.repo.saveSession(existing);
  const mutation = f.repo.commitCommercialMutation.bind(f.repo);
  f.repo.commitCommercialMutation = async value => {
    assert.deepEqual(value.expected, f.repo.getSession(merchantId, sessionId), "CAS expectation must remain canonical");
    return mutation(value);
  };
  const result = await f.bootstrap.bootstrap(input(), buyerId, true, { trustedBuyer: proof(), requireBuyerProof: true, refreshCart: true });
  assert.equal(result.session.customer?.cpf, account().cpf); assert.equal(result.session.globalUserId, buyerId);
});

test("a matching account cannot graft PII from another buyer's verified checkout", async () => {
  const f = fixture();
  f.setAccount(new BuyerAccount({ globalUserId: buyerId, email, passwordHash: "synthetic-hash",
    displayName: "Conta atual", createdAt: new Date(0), updatedAt: new Date(0) }));
  f.repo.saveSession(checkoutSession({ merchantId, sessionId: "synthetic-prior", globalUserId: "other-buyer",
    customer: { ...proof().customer, fullName: "Outro comprador", cpf: account().cpf, phone: account().phone,
      address: account().address, address_verified: true } }));
  const result = await f.run();
  assert.equal(result.session.customer?.fullName, "Conta atual");
  assert.equal(result.session.customer?.cpf, undefined); assert.equal(result.session.customer?.phone, undefined);
  assert.equal(result.session.customer?.address, undefined); assert.equal(f.accountWrites.length, 0);
});
