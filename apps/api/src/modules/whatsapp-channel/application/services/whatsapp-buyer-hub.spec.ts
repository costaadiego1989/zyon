import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppBuyerHubService } from "./whatsapp-buyer-hub.service.js";
import { WhatsAppCheckoutIdentityService } from "./whatsapp-checkout-identity.service.js";
import { BUYER_HUB_COMMANDS } from "../../domain/ui/buyer-hub.js";
import { buildMetaUiView, renderMetaUi } from "../../domain/ui/meta-ui-renderer.js";
import { CheckoutWhatsAppConversationAdapter } from "../../infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";

export const hubInput = (message: string, extra: Record<string, unknown> = {}): any => ({ merchantId: "shop", message,
  buyer: { globalUserId: "guest", phone: "5521993001883" }, verifiedSender: { inboxId: "inbox", leaseToken: "leased", deviceId: "META_CLOUD:config", fromNumber: "5521993001883" },
  state: { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "r", page: 0, previousViews: [],
    payment: { intentId: "existing", amount_cents: 1385, status: "approved" }, checkoutSessionId: "existing-checkout" }, ...extra });
const account = { globalUserId: "canonical", phone: "21993001883", displayName: "Diego", email: "buyer@example.com" };
export function hubFixture(options: any = {}) {
  const lookups: string[] = [], addressReads: string[] = [], proofs: any[] = [];
  const owner = { merchantId: "shop", conversationId: "conversation", phone: "5521993001883" };
  const hub = new WhatsAppBuyerHubService(options.identity ?? { recognize: async (proof: any) => {
    proofs.push(proof);
    return options.recognition ?? { status: "recognized", owner, buyer: { globalUserId: "canonical", merchantId: "shop", conversationId: "conversation" } };
  } } as never, { findByGlobalUserId: async (id: string) => { lookups.push(id); return options.account ?? account; } } as never,
  { list: async (id: string) => { addressReads.push(id); return options.addresses ?? []; } } as never);
  return { hub, lookups, addressReads, proofs };
}

test("HUB-01 root registry produces executable native shortcuts and retains current cart/payment state", async () => {
  const f = hubFixture(), input = hubInput("/atalhos"), before = structuredClone(input.state);
  const result = await f.hub.handle(input, "Athom"); assert.equal(result?.kind, "reply");
  if (result?.kind !== "reply") assert.fail();
  assert.deepEqual(result.response.quickReplies, BUYER_HUB_COMMANDS.map(c => c.label));
  assert.deepEqual(result.response.state.payment, before.payment); assert.equal(result.response.state.checkoutSessionId, before.checkoutSessionId);
  const view = buildMetaUiView(result.response);
  const choice = view.choices.find(c => c.label === "👤 Meus dados")!;
  assert.deepEqual(choice.action, { kind: "message", message: "👤 Meus dados" });
  const details = await f.hub.handle({ ...input, message: (choice.action as any).message }, "Athom");
  assert.equal(details?.kind, "reply"); if (details?.kind !== "reply") assert.fail();
  assert.match(details.response.agentMessage, /Diego/); assert.match(details.response.agentMessage, /buyer@example.com/);
  assert.deepEqual(f.lookups, ["canonical"]); assert.equal(f.proofs[0].verifiedSender.leaseToken, "leased");
  assert.deepEqual(input.state, before);
});

test("HUB-01 shopping shortcuts route to current existing operations without writing or creating payments", async () => {
  const f = hubFixture();
  for (const [command, tool] of [["/comprarapida", "checkout"], ["/carrinho", "get_cart"], ["/produtos", "search_products"],
    ["/categorias", "list_categories"], ["/ofertas", "get_daily_deals"]]) {
    const result = await f.hub.handle(hubInput(command!), "Athom");
    assert.equal(result?.kind, "route"); if (result?.kind !== "route") assert.fail();
    assert.equal(result.action?.kind, "tool"); assert.equal((result.action as any).tool, tool);
  }
  const unsupported = await f.hub.handle(hubInput("/privacidade excluir"), "Athom");
  assert.equal(unsupported?.kind, "reply"); if (unsupported?.kind === "reply") assert.match(unsupported.response.agentMessage, /ainda não está disponível/);
  assert.equal(f.lookups.length, 0);
});

test("HUB-02 missing current authenticated proof cannot expose profile or addresses", async () => {
  const identity = new WhatsAppCheckoutIdentityService({ findRegisteredByPhones: async () => assert.fail("no account lookup before authentication") } as never);
  const f = hubFixture({ identity });
  const result = await f.hub.handle(hubInput("/dados", { verifiedSender: undefined }), "Athom");
  assert.equal(result?.kind, "reply"); if (result?.kind !== "reply") assert.fail();
  assert.match(result.response.agentMessage, /Não consegui confirmar seu acesso/);
  assert.deepEqual(f.lookups, []); assert.deepEqual(f.addressReads, []);
});

test("HUB-02 ambiguous and foreign owner contexts reveal no account data and accept only a scoped email answer", async () => {
  const owner = { merchantId: "shop", conversationId: "conversation", phone: "5521993001883" };
  for (const recognition of [{ status: "ambiguous", owner }, { status: "recognized", owner: { ...owner, merchantId: "other" } },
    { status: "recognized", owner: { ...owner, conversationId: "other" } }]) {
    const f = hubFixture({ recognition }); const result = await f.hub.handle(hubInput("/enderecos"), "Athom");
    assert.equal(result?.kind, "reply"); if (result?.kind !== "reply") assert.fail();
    assert.ok(!result.response.agentMessage.includes("Diego")); assert.deepEqual(f.lookups, []); assert.deepEqual(f.addressReads, []);
    if (recognition.status === "ambiguous") {
      assert.equal(result.response.state.buyerHubIdentity?.command, "/enderecos");
      const resolved = hubFixture(); await resolved.hub.handle(hubInput("buyer@example.com", { state: result.response.state }), "Athom");
      assert.equal(resolved.proofs[0].emailHint, "buyer@example.com"); assert.deepEqual(resolved.addressReads, ["canonical"]);
    }
  }
});

test("HUB-02 canonical profile still requires the current account phone to match the verified sender", async () => {
  const f = hubFixture({ account: { ...account, phone: "5511988887777" } });
  const result = await f.hub.handle(hubInput("/dados"), "Athom"); assert.equal(result?.kind, "reply");
  if (result?.kind !== "reply") assert.fail();
  assert.ok(!result.response.agentMessage.includes("buyer@example.com")); assert.deepEqual(f.addressReads, []);
});

test("HUB-01 actual adapter intercepts the command and forwards no hub text to the model", async () => {
  const f = hubFixture(); const args: any[] = Array(21).fill(undefined);
  args[0] = {}; args[1] = { getSession: async () => undefined }; args[2] = { execute: async () => assert.fail("hub must not reach model") };
  args[3] = { executeForMerchant: async () => ({ name: "Athom" }) }; args[20] = f.hub;
  const adapter: CheckoutWhatsAppConversationAdapter = Reflect.construct(CheckoutWhatsAppConversationAdapter, args);
  const response = await adapter.respondStore(hubInput("/dados")); assert.match(response.agentMessage, /Diego/);
  assert.equal(response.state.payment?.intentId, "existing");
});
