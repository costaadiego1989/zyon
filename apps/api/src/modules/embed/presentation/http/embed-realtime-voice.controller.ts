import { BadRequestException, Body, Controller, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { buildVoiceInstructions, OpenAIRealtimeVoiceService } from "../../../../shared/openai/openai-realtime-voice.service.js";
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
    const session = await this.voiceSession(request, body);
    return this.realtime.createClientSecret(voiceSessionInput(session));
  }

  @Post("context")
  @RequireEmbedScope("checkout:chat")
  async currentContext(@Req() request: EmbedHttpRequest, @Body() body: { session_id?: unknown }) {
    const session = await this.voiceSession(request, body);
    return { instructions: buildVoiceInstructions(voiceSessionInput(session)) };
  }

  private async voiceSession(request: EmbedHttpRequest, body: { session_id?: unknown }): Promise<CheckoutSession> {
    if (typeof body.session_id !== "string" || !body.session_id.trim()) throw new BadRequestException("session_id_required");
    const embed = request.embedClaims!;
    const sessionId = body.session_id.trim();
    await this.checkoutGuards.assertSessionBelongsToEmbedMerchant(embed, sessionId);
    const session = await this.checkoutGuards.loadSession(embed.merchantId, sessionId);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    await this.billing.assertAllowed(embed.merchantId, { kind: "feature", key: "voiceCheckout" });
    return session;
  }
}

export function checkoutVoicePrompt(session: CheckoutSession): string {
  const stage = deriveChatStage(session);
  if (stage === "payment_pending") {
    return "Seu pagamento já está disponível na tela. Conclua por lá quando quiser. Se precisar, pode pedir para alterar pagamento, frete, endereço ou usar um cupom.";
  }
  if (stage === "payment") {
    return "Seu endereço e frete já estão definidos. Escolha a forma de pagamento exibida na tela.";
  }
  const previous = [...session.chatHistory].reverse().find(turn => turn.role === "agent")?.text;
  // Only reuse a genuine checkout turn, never the storefront introduction.
  const next = missingFieldsForStage(session, stage)[0];
  if (session.chatHistory.some(turn => turn.role === "buyer") && previous && promptMatchesPendingField(previous, next) && !/a partir de agora|sou (?:o |a |seu |sua )?assistente|como posso (?:te )?ajudar hoje/i.test(previous)) {
    return previous.replace(/^(?:Zion|Zyon)\s*:\s*/i, "").slice(0, 1200);
  }
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

function voiceSessionInput(session: CheckoutSession) {
  return { merchantId: session.merchantId, conversationId: session.sessionId, surface: "checkout" as const,
    checkoutPrompt: checkoutVoicePrompt(session), cart: checkoutCartContext(session) };
}

function promptMatchesPendingField(prompt: string, field: string | undefined): boolean {
  if (!field) return false;
  const patterns: Record<string, RegExp> = {
    telefone: /celular|telefone|DDD/i, email: /e-?mail/i, "código de verificação": /código|verifica/i,
    nome: /nome/i, CPF: /CPF/i, CEP: /CEP/i, "confirmar CEP": /CEP/i,
    "confirmar endereço": /endereço/i, "número": /número|imóvel/i,
    "complemento (ou responda que não tem)": /complemento/i, frete: /frete|entrega/i,
  };
  return patterns[field]?.test(prompt) ?? false;
}

function checkoutCartContext(session: CheckoutSession) {
  return {
    items: session.cart.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.price, variant: item.variantLabel ?? (item.variant?.startsWith("[") ? undefined : item.variant) })),
    total: session.cart.total,
    currency: session.cart.currency,
    shipping: session.shipping ? { carrier: session.shipping.carrier, method: session.shipping.method, customerPrice: session.shipping.customerPrice, deliveryDays: session.shipping.deliveryDays } : undefined,
  };
}
