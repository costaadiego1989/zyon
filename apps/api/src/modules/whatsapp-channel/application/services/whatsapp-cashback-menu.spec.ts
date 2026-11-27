import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppBuyerHubService } from "./whatsapp-buyer-hub.service.js";
import { WhatsAppCheckoutIdentityService } from "./whatsapp-checkout-identity.service.js";
import { CheckoutWhatsAppConversationAdapter } from "../../infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";
import { BUYER_HUB_COMMANDS, buyerHubCommands, buyerHubCommand, buyerHubRoute } from "../../domain/ui/buyer-hub.js";
import { buildMetaUiView, presentMetaUi, withMetaCartNavigation } from "../../domain/ui/meta-ui-renderer.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";
import { advance, emptyWallet, grantCredit } from "../../../cashback/domain/cashback.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";

const phone = "5521999990000";
const account = { globalUserId: "canonical", phone, displayName: "Comprador", email: "buyer@example.test" };
const owner = { merchantId: "shop", conversationId: "cart", phone };
const recognized = { status: "recognized", owner, buyer: { globalUserId: "canonical", merchantId: "shop", conversationId: "cart" } };
const input = (message: string, extra: any = {}): any => ({ merchantId: "shop", message,
  buyer: { globalUserId: "guest", phone }, verifiedSender: { inboxId: "inbox", leaseToken: "lease", deviceId: "META_CLOUD:config", fromNumber: phone },
  state: { version: 1, conversationId: "cart", stage: "store", history: [], revision: "r", page: 0, previousViews: [] }, ...extra });
const walletView = (merchantId = "shop", buyerId = "canonical"): any => ({ merchantId, buyerId, currency: "BRL",
  balance: { availableCents: 1234, pendingCents: 200, reservedCents: 100 }, program: { status: "active", version: 1, published: null } });

function hubFixture(options: any = {}) {
  const reads: any[] = [], proofs: any[] = [];
  const cashback = options.cashback ?? { wallet: async (...args: any[]) => { reads.push(args); return options.wallet ?? walletView(); } };
  const hub = new WhatsAppBuyerHubService(options.identity ?? { recognize: async (proof: any) => {
    proofs.push(proof); return options.recognition ?? recognized;
  } } as any, { findByGlobalUserId: async (id: string) => { assert.equal(id, "canonical"); return options.account ?? account; } } as any,
  { list: async () => assert.fail("balance navigation must not load addresses") } as any, cashback as any);
  return { hub, reads, proofs };
}

function adapterFixture(options: any = {}) {
  const args: any[] = Array(23).fill(undefined), configReads: string[] = [];
  args[0] = { execute: async () => assert.fail("menu navigation must not invoke checkout chat") };
  args[1] = { getSession: async () => assert.fail("menu navigation must not create or require checkout") };
  args[2] = { execute: options.store ?? (async () => assert.fail("menu navigation must not invoke model or commerce tool")) };
  args[3] = { executeForMerchant: async (id: string) => {
    configReads.push(id); return { name: "Loja", cashbackEnabled: options.enabled?.() ?? false };
  } };
  args[20] = options.hub;
  args[19] = options.decorator;
  return { adapter: Reflect.construct(CheckoutWhatsAppConversationAdapter, args) as CheckoutWhatsAppConversationAdapter, configReads };
}

test("CB-MENU-02 optional Cashback is a tenth executable entry and legacy registry stays at nine", () => {
  assert.equal(BUYER_HUB_COMMANDS.length, 9);
  assert.deepEqual(buyerHubCommands(), [...BUYER_HUB_COMMANDS]);
  assert.equal(buyerHubCommands(true).length, 10);
  for (const label of ["Cashback", "/cashback", " CASHBACK "]) assert.equal(buyerHubCommand(label), "/cashback");
  assert.deepEqual(buyerHubRoute("/cashback"), { message: "Meu saldo de cashback" });
});

for (const withHub of [false, true]) for (const enabled of [false, true]) for (const message of ["Oi", "menu", "/atalhos"]) {
  test(`CB-MENU-02 actual Meta menu materializes ${enabled ? 10 : 9} rows: hub=${withHub}, message=${message}`, async () => {
    const f = adapterFixture({ enabled: () => enabled, hub: withHub ? hubFixture().hub : undefined });
    const original = input(message), before = structuredClone(original);
    const response = await f.adapter.respondStore(original);
    assert.equal(response.quickReplies.includes("Cashback"), enabled);
    assert.deepEqual(original, before);
    const shown = presentMetaUi(withMetaCartNavigation(buildMetaUiView(response), true), "menu");
    assert.equal(shown.totalPages, 1);
    assert.equal(shown.numericSelections.length, enabled ? 10 : 9);
    const interactive = shown.messages.filter(m => m.type === "interactive") as any[];
    assert.equal(interactive.length, 1);
    const rows = interactive[0].interactive.action.sections.flatMap((s: any) => s.rows);
    assert.equal(rows.length, enabled ? 10 : 9);
    assert.ok(rows.length <= 10);
    assert.equal(rows.some((r: any) => r.title === "Cashback"), enabled);
    const choice = shown.numericSelections.find(a => a.kind === "message" && a.message === "Cashback");
    assert.equal(!!choice, enabled);
    assert.deepEqual(f.configReads, ["shop"]);
  });
}

test("CB-MENU-03 recognized buyer sees the existing canonical balance without any checkout", async () => {
  const h = hubFixture(), f = adapterFixture({ enabled: () => true, hub: h.hub });
  const response = await f.adapter.respondStore(input("Cashback"));
  assert.match(response.agentMessage, /saldo disponível.*12,34/);
  assert.match(response.agentMessage, /A liberar:.*2,00/);
  assert.match(response.agentMessage, /Reservado em pedidos:.*1,00/);
  assert.equal(response.state.checkoutSessionId, undefined);
  assert.deepEqual(h.reads, [["shop", "canonical"]]);
  assert.equal(h.proofs[0].verifiedSender.leaseToken, "lease");
});

test("CB-MENU-03 replayed former menu selection after pause remains protected and does not restore public menu", async () => {
  let enabled = true;
  const h = hubFixture(), f = adapterFixture({ enabled: () => enabled, hub: h.hub });
  const menu = await f.adapter.respondStore(input("menu"));
  const shown = presentMetaUi(buildMetaUiView(menu), "before-pause");
  const selection = shown.numericSelections.find(a => a.kind === "message" && a.message === "Cashback")!;
  assert.equal(selection.kind, "message");
  enabled = false;
  const balance = await f.adapter.respondStore(input((selection as any).message, { state: menu.state }));
  assert.match(balance.agentMessage, /12,34/);
  const pausedMenu = await f.adapter.respondStore(input("/atalhos", { state: balance.state }));
  assert.equal(pausedMenu.quickReplies.some(label => /cashback/i.test(label)), false);
  assert.deepEqual(h.reads, [["shop", "canonical"]]);
  assert.equal(f.configReads.length, 3);
});

test("CB-MENU-03 balance entry rejects missing proof, foreign merchant/cart/phone and mismatched account", async () => {
  const noProof = new WhatsAppCheckoutIdentityService({ findRegisteredByPhones: async () => assert.fail("missing trusted sender must not query accounts") } as any);
  const cases = [
    { identity: noProof, extra: { verifiedSender: undefined } },
    { recognition: { ...recognized, owner: { ...owner, merchantId: "foreign" } } },
    { recognition: { ...recognized, owner: { ...owner, conversationId: "foreign" } } },
    { recognition: { ...recognized, owner: { ...owner, phone: "551188887777" } } },
    { recognition: { ...recognized, buyer: { ...recognized.buyer, merchantId: "foreign" } } },
    { account: { ...account, phone: "551188887777" } },
  ];
  for (const options of cases) {
    const h = hubFixture(options);
    const result = await h.hub.handle(input("/cashback", options.extra), "Loja", true);
    assert.equal(result?.kind, "reply");
    if (result?.kind !== "reply") assert.fail();
    assert.doesNotMatch(result.response.agentMessage, /12,34|buyer@example/);
    assert.deepEqual(h.reads, []);
  }
});

test("CB-MENU-03 unavailable or foreign wallet fails closed without revealing the returned balance", async () => {
  for (const options of [{ wallet: walletView("foreign") }, { wallet: walletView("shop", "foreign") },
    { cashback: { wallet: async () => { throw new Error("storage unavailable"); } } }]) {
    const h = hubFixture(options);
    const result = await h.hub.handle(input("Cashback"), "Loja", true);
    assert.equal(result?.kind, "reply");
    if (result?.kind !== "reply") assert.fail();
    assert.match(result.response.agentMessage, /Não consegui consultar/);
    assert.doesNotMatch(result.response.agentMessage, /12,34/);
  }
});

test("CB-MENU-03 pause does not block an owned checkout's explicit removal of existing cashback", async () => {
  const checkout = checkoutSession({ merchantId: "shop", sessionId: "checkout", globalUserId: "canonical",
    shipping: undefined,
    customer: { fullName: "Comprador", email: "buyer@example.test", email_verified: true, phone, phone_verified: true } });
  checkout.cart.items[0]!.productType = "digital";
  checkout.cart.cart_ref = "cart";
  const args: any[] = Array(23).fill(undefined);
  args[0] = { execute: async () => assert.fail("explicit removal must not invoke checkout chat") };
  args[1] = { getSession: async () => checkout };
  args[2] = { execute: async () => assert.fail("explicit removal must not invoke sales model") };
  args[3] = { executeForMerchant: async () => ({ name: "Loja", cashbackEnabled: false }) };
  let removals = 0;
  args[21] = { releaseReservation: async (scope: any) => { removals++; assert.equal(scope, checkout); return { reservedCents: 0 }; },
    checkoutCashbackCents: async () => 0, reserveCheckout: () => assert.fail("removal must not reserve new credit") };
  const adapter = Reflect.construct(CheckoutWhatsAppConversationAdapter, args) as CheckoutWhatsAppConversationAdapter;
  const response = await adapter.respondStore(input("Remover cashback", { state: { ...input("").state, checkoutSessionId: "checkout" } }));
  assert.match(response.agentMessage, /Cashback removido/);
  assert.equal(removals, 1);
  assert.ok(response.quickReplies.every(label => !/cashback/i.test(label)));
});

test("CB-MENU-03 repeated balance navigation preserves grants and paid snapshots through the existing wallet service", async () => {
  const rules: any = { expiryDays: null, terms: "Existing published cashback terms" };
  const persisted = emptyWallet("shop", "canonical"), now = new Date();
  grantCredit(persisted, { orderId: "paid-order", amountCents: 1234, eligibleBaseCents: 20000,
    rules, ruleVersion: 1, lines: [], availableAt: now.toISOString() }, now);
  advance(persisted, now);
  const before = structuredClone(persisted);
  const state = { ...input("").state, checkoutSessionId: "existing-checkout",
    payment: { intentId: "paid", sessionId: "existing-checkout", status: "approved", amount_cents: 20000 } };
  const paidBefore = structuredClone(state);
  let saves = 0;
  const cashback = new CashbackService({ transaction: async (merchant: string, work: any) => {
    assert.equal(merchant, "shop"); return work({ $queryRaw: async () => [], $executeRaw: () => assert.fail("menu must not issue identity or commercial writes") });
  }, program: async (_tx: unknown, merchant: string) => ({ merchantId: merchant, status: "paused", published: rules, version: 1 }),
  wallet: async (_tx: unknown, merchant: string, buyer: string) => { assert.deepEqual([merchant, buyer], ["shop", "canonical"]); return structuredClone(persisted); },
  saveWallet: async (_tx: unknown, current: any) => { saves++; assert.deepEqual(current, before); },
  command: () => assert.fail("menu must not issue grant/reservation/redemption commands"),
  updateQuote: () => assert.fail("menu must not change paid earning snapshot") } as any);
  const h = hubFixture({ cashback }), f = adapterFixture({ enabled: () => false, hub: h.hub });
  for (const message of ["/cashback", "Cashback"]) {
    const response = await f.adapter.respondStore(input(message, { state }));
    assert.match(response.agentMessage, /12,34/);
    assert.deepEqual(response.state.payment, paidBefore.payment);
    assert.equal(response.state.checkoutSessionId, paidBefore.checkoutSessionId);
  }
  assert.equal(saves, 2, "retain the established wallet projection maintenance");
  assert.deepEqual(persisted, before);
  assert.deepEqual(state, paidBefore);
  assert.equal(persisted.grants.length, 1);
});

test("CB-MENU-04 inactive merchants suppress model and decorator cashback quick replies at outgoing boundary", async () => {
  const f = adapterFixture({ enabled: () => false,
    store: async () => ({ message: "Como posso ajudar?", blocks: [], suggested_next: ["Meu saldo de cashback", "Ver produtos"] }),
    decorator: { handle: async () => undefined,
      decorate: async (_id: string, response: any) => ({ ...response, quickReplies: [...response.quickReplies, "Usar cashback"] }) } });
  const response = await f.adapter.respondStore(input("Dúvida de produto", { state: { ...input("").state, history: [{ role: "user", content: "antes" }] } }));
  assert.deepEqual(response.quickReplies, ["Ver produtos"]);
});

for (const enabled of [true, false]) test(`CB-MENU-04 legacy checkout chat advertises cashback only when enabled=${enabled}`, async () => {
  const args: any[] = Array(23).fill(undefined);
  args[0] = { execute: async () => ({ message: "Posso ajudar", actions: [{ label: "Meu saldo de cashback" }, { label: "Ver produtos" }] }) };
  args[1] = { getSession: async () => checkoutSession({ merchantId: "shop" }) };
  args[21] = { isProgramEnabled: async (id: string) => { assert.equal(id, "shop"); return enabled; } };
  const adapter = Reflect.construct(CheckoutWhatsAppConversationAdapter, args) as CheckoutWhatsAppConversationAdapter;
  const response = await adapter.respond({ merchantId: "shop", checkoutSessionId: "checkout", message: "Dúvida" });
  assert.equal(response.quickReplies.some(label => /cashback/i.test(label)), enabled);
  assert.ok(response.quickReplies.includes("Ver produtos"));
});
