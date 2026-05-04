import { Inject, Injectable, Optional } from "@nestjs/common";
import type {
  AgentContext,
  CheckoutExperienceSnapshot,
  CheckoutItemSnapshot,
  StartCheckoutRequest,
  StartCheckoutResponse
} from "@aacp/shared-types";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { CheckoutSessionEntity } from "../../domain/entities/checkout-session.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import { withCheckoutTransaction } from "./checkout-transaction.js";

@Injectable()
export class StartCheckoutUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepository?: MerchantRepository,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort
  ) {}

  async execute(input: StartCheckoutRequest): Promise<StartCheckoutResponse> {
    return withCheckoutTransaction(this.repository, async (repository) => {
      const settings = await this.checkoutSettings?.getContext(input.merchant_id);
      const merchant = await this.merchantRepository?.getProfile(input.merchant_id);
      const sessionId = input.session_id ?? `chk_${crypto.randomUUID()}`;
      const globalUserId = await repository.resolveGlobalUserId(input.merchant_id, input.customer);
      const agent = await this.agentContext?.get({
        merchantId: input.merchant_id,
        globalUserId
      });
      const session = CheckoutSessionEntity.create({
        merchantId: input.merchant_id,
        sessionId,
        globalUserId,
        conversationId: `conv_${crypto.randomUUID()}`,
        cart: input.cart,
        customer: input.customer,
        shipping: input.shipping
      }).snapshot();

      await repository.saveSession(session);
      await repository.recordEvent(input.merchant_id, sessionId, "checkout_started");
      await repository.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "checkout.session.started",
          merchantId: input.merchant_id,
          payload: {
            session_id: session.sessionId,
            conversation_id: session.conversationId,
            global_user_id: session.globalUserId,
            cart_total: session.cart.total,
            currency: session.cart.currency,
            has_customer_hint: Boolean(input.customer),
            has_shipping_quote: Boolean(input.shipping)
          },
          causationId: session.sessionId
        })
      );

      return {
        conversation_id: session.conversationId,
        session_id: session.sessionId,
        global_user_id: session.globalUserId,
        agent_enabled: settings?.checkout_settings.mode !== "manual_only",
        initial_mode: settings?.checkout_settings.mode === "proactive" ? "open" : "silent",
        tracking_token: `trk_${crypto.randomUUID()}`,
        experience: buildCheckoutExperience(input, {
          merchantName: merchant?.name,
          agent
        })
      };
    });
  }
}

function buildCheckoutExperience(
  input: StartCheckoutRequest,
  deps: { merchantName?: string; agent?: AgentContext }
): CheckoutExperienceSnapshot {
  const merchantName = deps.merchantName ?? input.merchant_id;
  const items = input.cart.items.map(toItemSnapshot);
  const shipping = input.shipping?.customerPrice ?? 0;
  const discount = input.cart.currentDiscount ?? 0;
  const subtotal = input.cart.total;
  const total = Math.max(0, roundMoney(subtotal + shipping - discount));
  const agentIdentity = deps.agent?.agent;
  const agentName = agentIdentity?.agentName ?? "Assistente AACP";
  const greeting =
    agentIdentity?.greeting ??
    `Olá, sou o assistente da ${merchantName}. Posso te ajudar a finalizar este pedido.`;

  return {
    brand: {
      merchant_id: input.merchant_id,
      name: merchantName,
      subtitle: "Checkout assistido por IA",
      support_label: "Compra guiada"
    },
    items,
    totals: {
      currency: input.cart.currency,
      subtotal: roundMoney(subtotal),
      shipping: roundMoney(shipping),
      discount: roundMoney(discount),
      total
    },
    shipping: input.shipping,
    customer: input.customer,
    agent: {
      name: agentName,
      greeting,
      tone: agentIdentity?.tone ?? "consultative",
      language: agentIdentity?.language ?? "pt-BR"
    },
    copy: {
      headline: `${merchantName}: finalize sua compra com ajuda da IA`,
      subheadline: `${items.length} item(ns) no pedido, total ${formatMoney(total, input.cart.currency)} com contexto real do carrinho.`,
      trust_badges: [
        "IA respeita políticas comerciais da loja",
        "Frete, cupom e pagamento validados pela API",
        "Resumo do pedido sincronizado com a sessão"
      ],
      quick_replies: [
        "Tenho dúvida sobre o frete",
        "Existe algum cupom disponível?",
        "Quero finalizar agora"
      ]
    }
  };
}

function toItemSnapshot(item: StartCheckoutRequest["cart"]["items"][number]): CheckoutItemSnapshot {
  return {
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unit_price: roundMoney(item.price),
    line_total: roundMoney(item.price * item.quantity),
    image_url: item.imageUrl,
    product_url: item.productUrl,
    category: item.category,
    variant: item.variant
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number, currency: StartCheckoutRequest["cart"]["currency"]): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency" as const, currency }).format(value);
}
