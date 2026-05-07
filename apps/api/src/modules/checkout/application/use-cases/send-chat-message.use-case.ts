import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { evaluateDiscountOffer } from "@aacp/rules-engine";
import { evaluateShippingOffer } from "@aacp/shipping-engine";
import type {
  AuthorizedOffer,
  ChatMessageRequest,
  ChatMessageResponse,
  ChatStage,
  CheckoutSession,
  CustomerHints,
  MerchantRules
} from "@aacp/shared-types";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import { CONVERSATION_PORT, type ConversationPort } from "../../domain/ports/conversation.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../../merchant/domain/ports/merchant-repository.port.js";
import { createAuthorizedOffer } from "./offer-factory.js";
import {
  deriveChatStage,
  extractAddressDetailLine,
  extractCep,
  extractCpf,
  extractEmail,
  extractName,
  extractOtp,
  extractPhone,
  missingFieldsForStage
} from "../../domain/services/customer-extraction.service.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";
import { estimatePacQuote, lookupAddressByViaCep } from "../../domain/services/viacep-lookup.service.js";
import { BrevoBuyerEmailNotifier } from "../../infrastructure/brevo-buyer-email.notifier.js";

function structuredCloneDeep(session: CheckoutSession): CheckoutSession {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(session);
  return JSON.parse(JSON.stringify(session)) as CheckoutSession;
}

@Injectable()
export class SendChatMessageUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Inject(CONVERSATION_PORT) private readonly conversation: ConversationPort,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Optional() private readonly buyerEmailNotifier?: BrevoBuyerEmailNotifier
  ) {}

  async execute(input: ChatMessageRequest): Promise<ChatMessageResponse> {
    const session = await this.repository.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const rules = await this.repository.getRules(input.merchant_id);
    const merchant = await this.merchantRepo?.getProfile(input.merchant_id);

    const lastAgentTurn = [...session.chatHistory].reverse().find((t) => t.role === "agent")?.text;
    let working = structuredCloneDeep(session);

    const hadEmailAlready = Boolean(session.customer?.email?.trim());

    const customerPatch = this.buildCustomerPatch(input.user_message, working.customer, lastAgentTurn);
    if (customerPatch) {
      working = await this.repository.saveSession(mergeCustomers(working, customerPatch));
      if (customerPatch.email && !hadEmailAlready && this.buyerEmailNotifier) {
        const merged = mergeHints(session.customer, customerPatch);
        const buyerFirstHint = merged.fullName?.trim().split(/\s+/).filter(Boolean)[0];
        this.buyerEmailNotifier.notifyCaptured({
          buyerEmail: customerPatch.email.toLowerCase(),
          merchantId: input.merchant_id,
          sessionId: input.session_id,
          merchantName: merchant?.name,
          buyerFirstNameHint: buyerFirstHint
        });
      }
    }

    working = await this.tryFillPostalAndShipping(working);

    const numberPatch = this.tryParseAddressNumbers(input.user_message, working);
    if (numberPatch) working = await this.repository.saveSession(mergeCustomers(working, numberPatch));

    working = await this.tryEnsureShippingQuote(working);

    const stage = deriveChatStage(working);
    const missingFields = missingFieldsForStage(working, stage);

    const offer = await this.authorizeOffer(input.user_message, working, rules, stage, missingFields);
    const agentContext = await this.agentContext?.get({
      merchantId: input.merchant_id,
      userId: input.agent_user_id,
      agentId: input.agent_id,
      globalUserId: working.globalUserId
    });

    const reply = await this.conversation.reply({
      userMessage: input.user_message,
      brandVoice: rules.brandVoice,
      authorizedOffer: offer,
      agentContext,
      merchantName: merchant?.name,
      cart: working.cart,
      history: working.chatHistory,
      stage,
      missingFields,
      deliverySummary: summarizeDelivery(working)
    });

    const now = new Date().toISOString();
    await this.repository.appendChatTurn(input.merchant_id, input.session_id, {
      role: "buyer",
      text: input.user_message,
      occurredAt: now
    });
    const updated = await this.repository.appendChatTurn(input.merchant_id, input.session_id, {
      role: "agent",
      text: reply.message,
      occurredAt: new Date().toISOString(),
      authorizedOfferId: offer.approved ? offer.id : undefined
    });

    const experience = buildExperienceFromSession(updated, {
      merchantName: merchant?.name,
      theme: merchant?.theme,
      agent: agentContext,
      couponBoxEnabled: rules.couponBoxEnabled,
      rules
    });

    const wantsPix = /\b(pix|qr code)\b/i.test(input.user_message) && stage === "payment";
    const wantsCard = /\b(cartão|cartao|credito|crédito)\b/i.test(input.user_message) && stage === "payment";
    const chatActions: any[] = [];
    
    if (wantsPix) {
      chatActions.push({ label: "Gerar PIX", type: "continue_checkout" });
    } else if (wantsCard) {
      chatActions.push({ label: "Pagar com Cartão", type: "continue_checkout" });
    } else if (offer.approved) {
      const alreadyHasDiscount = offer.type.includes("discount") && working.cart.currentDiscount && working.cart.currentDiscount > 0;
      const alreadyHasFreeShipping = offer.type.includes("shipping") && working.shipping?.customerPrice === 0;
      if (!alreadyHasDiscount && !alreadyHasFreeShipping) {
        chatActions.push({ label: "Aplicar oferta", type: "apply_offer", offer_id: offer.id });
      }
    }

    return {
      message: reply.message,
      objection: reply.objection,
      authorized_offer: offer,
      actions: chatActions,
      turns: updated.chatHistory,
      experience,
      stage,
      missing_fields: missingFields
    };
  }

  private buildCustomerPatch(
    userMessage: string,
    existing: CustomerHints | undefined,
    lastAgentTurn: string | undefined
  ): Partial<CustomerHints> | null {
    const patch: Partial<CustomerHints> = {};
    const addr = existing?.address ?? {};
    
    let currentEmail = existing?.email;
    const otpPending = Boolean(existing?.otp_code);
    if (!currentEmail || (!otpPending && !existing?.email_verified)) {
      const email = extractEmail(userMessage);
      if (email) {
        patch.email = email.toLowerCase();
        currentEmail = patch.email;
      }
    }

    if (currentEmail && !existing?.email_verified) {
      if (!existing?.otp_code && !patch.otp_code && patch.email) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        patch.otp_code = code;
        console.log(`\n=========================================\n🔐 OTP GERADO PARA ${currentEmail}: ${code}\n=========================================\n`);
      } else if (existing?.otp_code) {
        const extracted = extractOtp(userMessage);
        if (extracted === existing.otp_code) {
          patch.email_verified = true;
          patch.otp_code = "";
        }
      }
    }

    if (!existing?.cpf) {
      const cpf = extractCpf(userMessage);
      if (cpf) patch.cpf = cpf;
    }
    if (!existing?.phone) {
      const phone = extractPhone(userMessage);
      if (phone) patch.phone = phone;
    }
    if (!existing?.address?.zip) {
      const zip = extractCep(userMessage);
      if (zip) patch.address = { ...addr, zip };
    }
    if (!existing?.fullName) {
      const name = extractName(userMessage, lastAgentTurn);
      if (name) patch.fullName = name;
    }
    return Object.keys(patch).length === 0 ? null : patch;
  }

  private async tryFillPostalAndShipping(session: CheckoutSession): Promise<CheckoutSession> {
    const zip = session.customer?.address?.zip?.replace(/\D/g, "");
    const beforeStreet = session.customer?.address?.street;
    if (zip?.length === 8 && !beforeStreet) {
      const via = await lookupAddressByViaCep(zip);
      if (via) {
        const next = mergeCustomers(session, {
          address: mergeAddr(session.customer?.address, via)
        });
        return this.repository.saveSession(next);
      }
    }
    return session;
  }

  private tryParseAddressNumbers(text: string, session: CheckoutSession): Partial<CustomerHints> | null {
    const addr = session.customer?.address ?? {};
    if (!addr.street || addr.number || !addr.zip) return null;
    const ln = extractAddressDetailLine(text);
    if (!ln?.number) return null;
    return { address: { ...addr, number: ln.number, complement: ln.complement ?? addr.complement } };
  }

  private async tryEnsureShippingQuote(session: CheckoutSession): Promise<CheckoutSession> {
    const addr = session.customer?.address;
    if (
      !addr?.zip ||
      !addr?.street ||
      !addr.city ||
      !addr.state ||
      !addr.number ||
      session.shipping?.customerPrice
    ) {
      return session;
    }
    const q = estimatePacQuote({ zip: addr.zip, state: addr.state });
    return this.repository.saveSession({
      ...session,
      shipping: {
        customerPrice: q.customerPrice,
        realCost: q.realCost,
        carrier: q.carrier,
        method: q.method,
        deliveryDays: q.deliveryDays,
        region: q.region,
        destinationZip: q.destinationZip
      },
      updatedAt: new Date().toISOString()
    });
  }

  private async authorizeOffer(
    userMessage: string,
    sessionObj: CheckoutSession,
    rules: MerchantRules,
    stage: ChatStage,
    missingFields: string[]
  ): Promise<AuthorizedOffer> {
    const isDataCollection = stage === "data_collection";
    const isIncompleteShipping = stage === "shipping" && missingFields.some(f => f.includes("CEP") || f.includes("número") || f.includes("confirmar"));

    if (isDataCollection || isIncompleteShipping) {
      return this.repository.saveOffer(
        createAuthorizedOffer({
          merchantId: sessionObj.merchantId,
          sessionId: sessionObj.sessionId,
          rules,
          evaluation: {
            approved: false,
            type: "none",
            value: 0,
            reason: "complete_customer_before_offers",
            marginAfterOffer: 0
          }
        })
      );
    }

    const wantsShipping = /(frete|envio|shipping)/.test(userMessage.toLowerCase());
    const evaluation = wantsShipping
      ? evaluateShippingOffer({
          cart: sessionObj.cart,
          shipping: sessionObj.shipping,
          rules,
          abandonmentScore: Math.max(sessionObj.abandonmentScore, 0.7)
        })
      : evaluateDiscountOffer(sessionObj.cart, rules, rules.maxDiscountPercent);
    const offer = createAuthorizedOffer({
      merchantId: sessionObj.merchantId,
      sessionId: sessionObj.sessionId,
      rules,
      evaluation
    });
    return this.repository.saveOffer(offer);
  }
}

function mergeCustomers(s: CheckoutSession, partial: Partial<CustomerHints>): CheckoutSession {
  return {
    ...s,
    customer: mergeHints(s.customer, partial),
    updatedAt: new Date().toISOString()
  };
}

function mergeHints(a: CustomerHints | undefined, b: Partial<CustomerHints>): CustomerHints {
  const { address: addrPatch, ...rest } = b;
  const merged = { ...(a ?? {}), ...rest } as CustomerHints;
  if (addrPatch !== undefined) merged.address = mergeAddr(a?.address, addrPatch);
  return merged;
}

function mergeAddr(
  a: CustomerHints["address"] | undefined,
  b: Partial<NonNullable<CustomerHints["address"]>> | undefined
): CustomerHints["address"] | undefined {
  if (!b && !a) return undefined;
  return {
    ...(a ?? {}),
    ...(b ?? {})
  };
}

function summarizeDelivery(session: CheckoutSession): string | undefined {
  const a = session.customer?.address;
  if (!a?.street) return undefined;
  const parts = [
    a.street,
    a.number ? `nº ${a.number}` : undefined,
    a.complement ?? undefined,
    a.neighborhood,
    a.city && a.state ? `${a.city}/${a.state}` : undefined,
    a.zip ? `CEP ${a.zip.slice(0, 5)}-${a.zip.slice(5)}` : undefined,
    session.shipping?.customerPrice ? `Frete cliente: R$${session.shipping.customerPrice.toFixed(2)}` : undefined,
    session.shipping?.deliveryDays ? `Prazo est.: ~${session.shipping.deliveryDays} dias úteis` : undefined
  ].filter(Boolean);
  if (parts.length === 0) return undefined;
  return `Referência para entrega: ${parts.join(" · ")}`;
}
