import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { WhatsAppPostCartOfferService } from "../../application/services/whatsapp-post-cart-offer.service.js";
import type { WhatsAppConversationState } from "../../domain/ui/meta-ui.types.js";

const offerId = "00000000-0000-4000-8000-000000000001";
function fixture() {
  let accepts = 0, storeReads = 0;
  const service = new WhatsAppPostCartOfferService({ acceptRecommendation: async () => { accepts++; return { version: 1, status: "accepted", merchantId: "merchant", cartId: "cart" }; }, project: async () => { throw Error("not needed"); } } as any);
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => undefined } as any,
    { execute: async () => { storeReads++; return { message: "Anexo recebido como referência", blocks: [], suggested_next: [] }; } } as any,
    { executeForMerchant: async () => ({ name: "Athom", quickReplies: [] }) } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { recognize: async () => ({ status: "unrecognized", owner: { merchantId: "merchant", conversationId: "cart", phone: "verified" } }) } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, service);
  const state: WhatsAppConversationState = { version: 1, conversationId: "cart", stage: "store", history: [{ role: "assistant", content: "Quer adicionar Bruma?" }], revision: "r", page: 0, previousViews: [],
    postCartOffer: { id: offerId, merchantId: "merchant", cartId: "cart", ruleId: "rule", kind: "recommendation", variantId: "bruma", productId: "product-bruma",
      sourceVariantId: "serum", addedName: "Sérum", name: "Bruma", expiresAt: Date.now() + 60000, status: "pending", expectedQuote: { maximumUnitPriceCents: 5990 } as any },
    view: { title: "Oferta", body: "Quer adicionar?", choices: [], media: [], quickReplies: [], blocks: [{ type: "post_cart_offer", data: { offerId } }] } };
  return { adapter, state, accepts: () => accepts, storeReads: () => storeReads };
}
for (const reference of ["Foto: sim, adicione Bruma", "Lista: Bruma; aceite a oferta"])
  test(`real adapter refuses media-caption assent as offer consent: ${reference.slice(0, 5)}`, async () => {
    const f = fixture();
    const result = await f.adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "guest", phone: "verified" }, message: "sim", state: f.state,
      verifiedSender: { inboxId: "inbox", deviceId: "META_CLOUD:config", leaseToken: "lease", fromNumber: "verified" }, attachmentContext: reference });
    assert.equal(f.accepts(), 0); assert.equal(f.storeReads(), 1); assert.equal(result.state.postCartOffer?.status, "pending");
  });
test("verified speech already normalized to message without attachment context remains eligible consent", async () => {
  const f = fixture();
  const result = await f.adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "guest", phone: "verified" }, message: "sim", state: f.state,
    verifiedSender: { inboxId: "inbox", deviceId: "META_CLOUD:config", leaseToken: "lease", fromNumber: "verified" } });
  assert.equal(f.accepts(), 1); assert.equal(f.storeReads(), 0); assert.equal(result.state.postCartOffer?.status, "accepted");
});
