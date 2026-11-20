/** Synthetic boundaries around the real canonical registration/shipping/chat services. */
import type { PrismaClient } from "@prisma/client";
import type { EmailSenderPort, SendEmailInput } from "../src/modules/notifications/domain/ports/email-sender.port.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { CheckoutCustomerService } from "../src/modules/checkout/application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../src/modules/checkout/application/services/checkout-shipping.service.js";
import { OtpService } from "../src/modules/checkout/application/services/otp.service.js";
import { DeterministicConversationAdapter } from "../src/modules/checkout/infrastructure/adapters/deterministic-conversation.adapter.js";
import { SendChatMessageUseCase } from "../src/modules/checkout/application/use-cases/send-chat-message.use-case.js";
import { ChatContextService } from "../src/modules/checkout/application/services/chat-context.service.js";
import { ChatResponseBuilder } from "../src/modules/checkout/application/services/chat-response.builder.js";
import { InterventionRuleTextBuilder } from "../src/modules/checkout/application/services/intervention-rule-text.builder.js";
import { SafeAuthorizedOffer } from "../src/modules/checkout/domain/types/safe-authorized-offer.js";
import { FiscalRecipientCollectionService } from "../src/modules/fiscal/application/fiscal-recipient-collection.service.js";
import { PrismaFiscalRecipientCollectionRepository } from "../src/modules/fiscal/infrastructure/prisma-fiscal-recipient-collection.repository.js";
import type { FiscalBeforePaymentPort } from "../src/modules/fiscal/domain/fiscal-checkout.port.js";
import type { FiscalPostalLookupPort } from "../src/modules/fiscal/domain/fiscal-postal-lookup.port.js";
import type { CreatePaymentIntentUseCase } from "../src/modules/payment/application/create-payment-intent.use-case.js";

export function createFiscalOtpEmailFixture() {
  const accepted: SendEmailInput[] = [];
  const sender: EmailSenderPort = { send: async input => {
    accepted.push(structuredClone(input));
    return { status: "sent", messageId: "synthetic-fiscal-otp" };
  } };
  return { accepted, sender };
}

export function createFiscalConversationHarness(prisma: PrismaClient, gate: FiscalBeforePaymentPort, postal: FiscalPostalLookupPort, payment: CreatePaymentIntentUseCase) {
  const sessions = new PrismaCheckoutRepository(prisma);
  const otpEmails = createFiscalOtpEmailFixture();
  const customer = new CheckoutCustomerService(sessions, undefined, new OtpService(), undefined, undefined, otpEmails.sender);
  const shipping = new CheckoutShippingService(sessions, customer, { execute: async () => ({ id: "local_quote", quote_key: "local_quote_key", destination_zip: "01001000", expires_at: new Date(Date.now() + 3600000).toISOString(), results: [{ price: 0, label: "Entrega confirmada", source: "own_delivery", eta_days: 1 }] }) } as never,
    { toFetch: () => async () => Response.json({ logradouro: "Rua Um", bairro: "Centro", localidade: "Sao Paulo", uf: "SP", ibge: "3550308" }) } as never, undefined, prisma);
  const collector = new FiscalRecipientCollectionService(new PrismaFiscalRecipientCollectionRepository(prisma), gate, postal);
  const chat = new SendChatMessageUseCase(sessions, new DeterministicConversationAdapter(), customer, shipping,
    { authorizeOffer: async (_text: string, session: { merchantId: string; sessionId: string }) => SafeAuthorizedOffer.noOffer(session.merchantId, session.sessionId) } as never,
    new ChatContextService(sessions, new InterventionRuleTextBuilder()), new ChatResponseBuilder(sessions, undefined, payment, undefined, { platformFeeBrl: 0 }), { platformFeeBrl: 0 },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, collector, gate);
  return { sessions, customer, shipping, chat, acceptedOtpEmails: otpEmails.accepted };
}
