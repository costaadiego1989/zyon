import assert from "node:assert/strict";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { createStartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.fixture.js";
import { createSendChatUseCase } from "../../../checkout/application/use-cases/send-chat-message.fixture.js";
import { CheckoutCustomerService } from "../../../checkout/application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../../checkout/application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../../checkout/application/services/checkout-offer.service.js";
import { BuyerAccountPersistenceService } from "../../../checkout/application/services/buyer-account-persistence.service.js";
import { DeterministicConversationAdapter } from "../../../checkout/infrastructure/adapters/deterministic-conversation.adapter.js";
import { buildMetaUiView, presentMetaUi } from "../../domain/ui/meta-ui-renderer.js";
import type { WhatsAppConversationState, StoreUiAction } from "../../domain/ui/meta-ui.types.js";

export const linkedAddress = { zip: "01310100", street: "Avenida Paulista", number: "1578", complement: "Apto 42",
  neighborhood: "Bela Vista", city: "São Paulo", state: "SP" };
export function linkedCheckoutFixture() {
  const repository = new InMemoryCheckoutRepository();
  const customer = { fullName: "Compradora Vinculada", email: "compradora@example.test", cpf: "52998224725", phone: "5511987654321",
    phone_verified: true as const, email_verified: false as const, recognized_buyer: true, isReturning: true,
    address: structuredClone(linkedAddress), address_verified: false };
  const buyer = { merchantId: "linked_merchant", conversationId: "linked_cart", globalUserId: "linked_account", customer };
  const stats = { accountWrites: 0, payments: 0, otp: 0, quotes: 0 };
  const accountPersistence = new BuyerAccountPersistenceService({ save: async () => { stats.accountWrites++; assert.fail("delivery choice cannot overwrite the default account address"); } } as any);
  const customers = new CheckoutCustomerService(repository, undefined, { processEmailOtp: () => { stats.otp++; assert.fail("known account cannot repeat OTP"); } } as any,
    undefined, accountPersistence);
  const prisma: any = { checkoutSession: { findUnique: async ({ where }: any) => repository.getSession(where.merchantId_sessionId.merchantId, where.merchantId_sessionId.sessionId) },
    crossStoreLineItem: { findFirst: async () => null }, paymentIntent: { findFirst: async () => null }, completedOrder: { findFirst: async () => null },
    storefrontCart: { findUnique: async () => ({ items: [{ sku: "kit", quantity: 1 }], expiresAt: new Date(Date.now() + 3600_000) }) } };
  const quotes: any = { quoteKey: async () => "linked-quote", assertNeighborhoodDestination: async () => {}, execute: async (request: any) => {
    stats.quotes++;
    return { id: "linked-quote-id", quote_key: "linked-quote", destination_zip: request.destination_zip, expires_at: new Date(Date.now() + 60_000).toISOString(),
      results: [{ carrier_key: "pac", label: "Correios PAC", price: 1500, eta_days: 6, is_free: false }] };
  } };
  const shipping = new CheckoutShippingService(repository, customers, quotes, undefined, undefined, prisma);
  const cart: any = { currency: "BRL", source: "storefront", cart_ref: buyer.conversationId, total: 30,
    items: [{ sku: "kit", name: "Kit de teste", price: 30, quantity: 1, productType: "physical" }] };
  const authority: any = { resolveStorefront: async () => structuredClone(cart) };
  const start = createStartCheckoutUseCase(repository, { appendOutbox: async () => {} }, { cartAuthority: authority, customerService: customers });
  start.getPaymentCapabilities = async () => ({ pix: true, card: true, boleto: false, crypto: false } as any);
  const chat = createSendChatUseCase(repository, { conversation: new DeterministicConversationAdapter(), customerService: customers,
    shippingService: shipping, offerService: new CheckoutOfferService(repository) });
  const args: any[] = [];
  args[0] = chat; args[1] = repository;
  args[2] = { execute: async () => ({ message: "Finalizando", blocks: [{ type: "checkout_prepared", data: {} }], suggested_next: [] }) };
  args[3] = { executeForMerchant: async () => ({ name: "Loja QA" }) }; args[4] = start; args[7] = authority;
  args[8] = { execute: async () => { stats.payments++; assert.fail("delivery selection cannot submit a charge"); } };
  args[10] = prisma; args[11] = { recognize: async () => ({ status: "recognized", buyer,
    owner: { merchantId: buyer.merchantId, conversationId: buyer.conversationId, phone: customer.phone } }) };
  args[12] = customers; args[18] = shipping;
  const adapter: CheckoutWhatsAppConversationAdapter = Reflect.construct(CheckoutWhatsAppConversationAdapter, args);
  let state: WhatsAppConversationState = { version: 1, conversationId: buyer.conversationId, stage: "store", history: [], revision: "", page: 0, previousViews: [] };
  let revision = 0, selections: Record<string, StoreUiAction> = {};
  const originalFetch = globalThis.fetch;
  async function turn(message: string, action?: StoreUiAction) {
    const response = await adapter.respondStore({ merchantId: buyer.merchantId, buyer: { globalUserId: "old_guest", phone: customer.phone }, message, action, state,
      verifiedSender: { inboxId: "synthetic_current_inbox", leaseToken: "synthetic_current_lease", deviceId: "META_CLOUD:synthetic_config", fromNumber: customer.phone } });
    state = response.state;
    const view = buildMetaUiView(response), presentation = presentMetaUi(view, "linked-" + ++revision, 0, { native: true });
    selections = presentation.selections;
    return { response, view, presentation };
  }
  return { repository, buyer, stats, cart,
    start: () => turn("Finalizar compra", { kind: "tool", tool: "checkout", args: {} }),
    turn,
    select: (id: string) => { const action = selections[id]; assert.ok(action, "selection must belong to the current rendered menu");
      assert.equal(action.kind, "message"); return turn(action.kind === "message" ? action.message : "", action); },
    session: () => state.checkoutSessionId ? repository.getSession(buyer.merchantId, state.checkoutSessionId) : undefined,
    enablePostalStub: () => { globalThis.fetch = (async (url: any, init: any) => String(url).startsWith("https://viacep.com.br/ws/")
      ? new Response(JSON.stringify({ logradouro: "Rua Nova", bairro: "Copacabana", localidade: "Rio de Janeiro", uf: "RJ" }), { status: 200 })
      : originalFetch(url, init)) as typeof fetch; },
    close: () => { globalThis.fetch = originalFetch; },
  };
}
