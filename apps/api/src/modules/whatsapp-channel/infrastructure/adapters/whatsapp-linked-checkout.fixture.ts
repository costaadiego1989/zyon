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
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import type { WhatsAppConversationState, StoreUiAction } from "../../domain/ui/meta-ui.types.js";
import type { TrustedWhatsAppCheckoutBuyer } from "../../../checkout/application/services/trusted-checkout-buyer.js";

export const linkedAddress = { zip: "01310100", street: "Avenida Paulista", number: "1578", complement: "Apto 42",
  neighborhood: "Bela Vista", city: "São Paulo", state: "SP" };
export function linkedCheckoutFixture() {
  const repository = new InMemoryCheckoutRepository();
  const customer = { fullName: "Compradora Vinculada", email: "compradora@example.test", cpf: "52998224725", phone: "5511987654321",
    phone_verified: true as const, email_verified: false as const, recognized_buyer: true, isReturning: true,
    address: structuredClone(linkedAddress), address_verified: false };
  const buyer: TrustedWhatsAppCheckoutBuyer = { merchantId: "linked_merchant", conversationId: "linked_cart", globalUserId: "linked_account", customer };
  const stats = { accountWrites: 0, payments: 0, otp: 0, quotes: 0 };
  const financial = { cancellations: 0, reassignments: 0 };
  let linkedProof = true, storedPayment: any, storedOrder: any;
  const saveSession = repository.saveSession.bind(repository);
  repository.saveSession = (session: any) => {
    const previous = repository.getSession(session.merchantId, session.sessionId);
    if (previous && previous.globalUserId !== session.globalUserId) financial.reassignments++;
    return saveSession(session);
  };
  const accountPersistence = new BuyerAccountPersistenceService({ save: async () => { stats.accountWrites++; assert.fail("delivery choice cannot overwrite the default account address"); } } as any);
  const customers = new CheckoutCustomerService(repository, undefined, { processEmailOtp: () => { stats.otp++; assert.fail("known account cannot repeat OTP"); } } as any,
    undefined, accountPersistence);
  const prisma: any = { checkoutSession: { findUnique: async ({ where }: any) => repository.getSession(where.merchantId_sessionId.merchantId, where.merchantId_sessionId.sessionId) },
    crossStoreLineItem: { findFirst: async () => null },
    paymentIntent: { findFirst: async () => storedPayment ? structuredClone(storedPayment) : null },
    completedOrder: { findFirst: async () => storedOrder ? structuredClone(storedOrder) : null },
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
  args[10] = prisma; args[11] = { recognize: async () => ({ status: "recognized", ...(linkedProof ? { linkedAccount: true } : {}), buyer,
    owner: { merchantId: buyer.merchantId, conversationId: buyer.conversationId, phone: customer.phone } }) };
  args[13] = { execute: async () => { financial.cancellations++; assert.fail("profile reuse cannot cancel an existing payment"); } };
  args[15] = { listForSession: async () => storedPayment ? [{ snapshot: () => structuredClone(storedPayment) }] : [] };
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
  return { repository, buyer, stats, cart, financial,
    start: () => turn("Finalizar compra", { kind: "tool", tool: "checkout", args: {} }),
    turn,
    select: (id: string) => { const action = selections[id]; assert.ok(action, "selection must belong to the current rendered menu");
      assert.equal(action.kind, "message"); return turn(action.kind === "message" ? action.message : "", action); },
    session: () => state.checkoutSessionId ? repository.getSession(buyer.merchantId, state.checkoutSessionId) : undefined,
    setLinked: (value: boolean) => { linkedProof = value; },
    setPreferences: (value: TrustedWhatsAppCheckoutBuyer["preferences"]) => { buyer.preferences = value; },
    seedInFlight: async (options: { sameAccount?: boolean; paymentStatus?: string; order?: boolean } = {}) => {
      const old = await start.execute({ merchant_id: buyer.merchantId, session_id: "old_inflight_checkout", cart: structuredClone(cart), customer: { phone: customer.phone } },
        { storefrontCartRef: buyer.conversationId, trustedPhoneBuyer: { globalUserId: options.sameAccount ? buyer.globalUserId : "old_guest", phone: customer.phone } });
      state = { ...state, stage: "checkout", checkoutSessionId: old.session_id, checkoutConversationId: old.conversation_id };
      const session = repository.getSession(buyer.merchantId, old.session_id)!;
      if (options.paymentStatus) storedPayment = { id: "existing_intent", merchantId: buyer.merchantId, sessionId: old.session_id,
        status: options.paymentStatus, amountCents: 3000, method: "pix", providerPaymentId: "original_provider_reference" };
      if (options.order) storedOrder = { id: "existing_order", merchantId: buyer.merchantId, sessionId: old.session_id,
        globalUserId: session.globalUserId, externalOrderId: "original_order_reference", status: "approved", orderTotal: 30, shippingCents: 0, currency: "BRL" };
      return { session: structuredClone(session), payment: structuredClone(storedPayment), order: structuredClone(storedOrder), fingerprint: paymentCartFingerprint(session) };
    },
    financialRecords: () => ({ payment: structuredClone(storedPayment), order: structuredClone(storedOrder) }),
    enablePostalStub: () => { globalThis.fetch = (async (url: any, init: any) => String(url).startsWith("https://viacep.com.br/ws/")
      ? new Response(JSON.stringify({ logradouro: "Rua Nova", bairro: "Copacabana", localidade: "Rio de Janeiro", uf: "RJ" }), { status: 200 })
      : originalFetch(url, init)) as typeof fetch; },
    close: () => { globalThis.fetch = originalFetch; },
  };
}
