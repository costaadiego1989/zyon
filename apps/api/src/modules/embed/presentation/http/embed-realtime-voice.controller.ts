import { BadRequestException, Body, Controller, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { OpenAIRealtimeVoiceService } from "../../../../shared/openai/openai-realtime-voice.service.js";
import { BillingPlanMeteringService } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { RequireEmbedScope } from "./embed-scope.decorator.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "./embed-checkout.controller.js";
import { deriveChatStage, missingFieldsForStage } from "../../../checkout/domain/services/customer-extraction.service.js";

@UseGuards(EmbedAuthGuard)
@Controller("embed/realtime")
export class EmbedRealtimeVoiceController {
  constructor(
    private readonly checkoutGuards: EmbedCheckoutGuardHelper,
    private readonly billing: BillingPlanMeteringService,
    private readonly realtime: OpenAIRealtimeVoiceService,
  ) {}

  @Post("session")
  @RequireEmbedScope("checkout:chat")
  async createSession(@Req() request: EmbedHttpRequest, @Body() body: { session_id?: unknown }) {
    if (typeof body.session_id !== "string" || !body.session_id.trim()) throw new BadRequestException("session_id_required");
    const embed = request.embedClaims!;
    const sessionId = body.session_id.trim();
    await this.checkoutGuards.assertSessionBelongsToEmbedMerchant(embed, sessionId);
    const session = await this.checkoutGuards.loadSession(embed.merchantId, sessionId);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    await this.billing.assertAllowed(embed.merchantId, { kind: "feature", key: "voiceCheckout" });
    return this.realtime.createClientSecret({ merchantId: embed.merchantId, conversationId: sessionId, surface: "checkout", checkoutPrompt: checkoutVoicePrompt(session), cart: checkoutCartContext(session) });
  }
}

export function checkoutVoicePrompt(session: CheckoutSession): string {
  const previous = [...session.chatHistory].reverse().find(turn => turn.role === "agent")?.text;
  // Only reuse a genuine checkout turn, never the storefront introduction.
  if (session.chatHistory.some(turn => turn.role === "buyer") && previous && !/a partir de agora|sou (?:o |a |seu |sua )?assistente|como posso (?:te )?ajudar hoje/i.test(previous)) {
    return previous.replace(/^(?:Zion|Zyon)\s*:\s*/i, "").slice(0, 1200);
  }
  const next = missingFieldsForStage(session, deriveChatStage(session))[0];
  const prompts: Record<string, string> = {
    telefone: "Qual é seu celular com DDD para contato sobre o pedido? Para confirmar seu acesso, enviaremos um código por e-mail.",
    email: "Qual é seu e-mail para este pedido?",
    "código de verificação": "Qual é o código de seis dígitos enviado ao seu e-mail? Se o e-mail estiver errado, pode pedir para corrigir.",
    nome: "Qual é seu nome completo para este pedido?",
    CPF: "Qual é seu CPF para este pedido?",
    CEP: "Qual é o CEP de entrega?",
    "confirmar CEP": "Vamos confirmar o CEP de entrega. Qual é o CEP correto?",
    "confirmar endereço": "O endereço de entrega exibido está correto?",
    "número": "Qual é o número do imóvel?",
    "complemento (ou responda que não tem)": "Tem complemento? Se não houver, diga sem complemento.",
    frete: "Vamos escolher o frete para seu pedido. Qual opção prefere?",
    "forma de pagamento": "Seu pedido está pronto para a etapa de pagamento. Como deseja pagar?",
  };
  return prompts[next] ?? "Vamos continuar seu pedido na etapa de pagamento exibida na tela.";
}

function checkoutCartContext(session: CheckoutSession) {
  return {
    items: session.cart.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.price, variant: item.variantLabel ?? (item.variant?.startsWith("[") ? undefined : item.variant) })),
    total: session.cart.total,
    currency: session.cart.currency,
    shipping: session.shipping ? { carrier: session.shipping.carrier, method: session.shipping.method, customerPrice: session.shipping.customerPrice, deliveryDays: session.shipping.deliveryDays } : undefined,
  };
}
