import type { Prisma } from "@prisma/client";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";
import type { WhatsAppRoutingCheckoutInput } from "../../domain/ports/whatsapp-session-repository.port.js";

/** Called within the actual routing transaction, never an independent client. */
export async function createWhatsAppRoutingCheckoutWithin(tx: Prisma.TransactionClient, input: WhatsAppRoutingCheckoutInput): Promise<void> {
  await lockCheckoutSessionAnchor(tx, input.merchantId, input.sessionId);
  await tx.checkoutSession.create({ data: {
    merchantId: input.merchantId, sessionId: input.sessionId, globalUserId: input.globalUserId,
    conversationId: input.conversationId, customer: input.customer,
    cart: { items: [], total: 0, currency: "BRL" }, chatHistory: [], abandonmentScore: 0,
    triggerAgent: false, createdAt: input.now, updatedAt: input.now,
  } });
}
