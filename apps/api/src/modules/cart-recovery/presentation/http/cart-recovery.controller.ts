import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { GetRecoveryMetricsUseCase } from "../../application/use-cases/get-recovery-metrics.use-case.js";
import { GetStrategyPreferencesUseCase } from "../../application/use-cases/get-strategy-preferences.use-case.js";
import { UpdateStrategyPreferencesUseCase } from "../../application/use-cases/update-strategy-preferences.use-case.js";
import { WHATSAPP_SENDER_PORT } from "../../../notifications/domain/ports/whatsapp-sender.port.js";
import type { WhatsAppSenderPort } from "../../../notifications/domain/ports/whatsapp-sender.port.js";

interface TemplateConfig {
  coupon_code?: string;
  rule_id?: string;
  recovery_link?: string;
}

const TEMPLATES: Record<string, (cfg: TemplateConfig) => string> = {
  offer_free_shipping: (cfg) => `🚚 *Frete Grátis Pra Você!*

Seu carrinho está te esperando! 👜

Voltou interesse? Ótima notícia: hoje temos *FRETE GRÁTIS* em tudo que você deixou guardado.

👉 *Voltar pro carrinho:* ${cfg.recovery_link ?? "[link do carrinho]"}

⏰ Oferta válida por 48 horas
🎁 Aproveita que é grátis!`,

  personalized_cross_sell: (cfg) => `🛒 *Esqueceu Algo no Carrinho?*

Oi! Vimos que você deixou alguns itens incríveis esperando. 👀

Preparamos sugestões especiais baseadas no que você escolheu:
• Produto complementar 1
• Produto complementar 2
• Produto complementar 3

Quer ver? É só voltar pro carrinho!

👉 *Acessar carrinho:* ${cfg.recovery_link ?? "[link do carrinho]"}

💭 Dúvidas? É só chamar aqui!`,

  offer_coupon: (cfg) => `🎉 *Cupom Exclusivo Pra Você!*

Sua compra merecia um descontão! 🤑

Use o código *${cfg.coupon_code || "VOLTA10"}* na hora de finalizar o pedido.

👉 *Voltar e aplicar:* ${cfg.recovery_link ?? "[link do carrinho]"}

⏰ Código válido por 3 dias
🔐 Exclusivo — só pra você!

Bora fechar? 🛍️`,

  advanced_rule: (cfg) => `✨ *Oferta Personalizada Esperando!*

Olha só que legal: preparamos uma condição especial só pra você! 🎯

Com base no que você deixou no carrinho, temos:
💳 Parcelamento em até 12x sem juros
⏱️ Frete com desconto de 40%
🎁 Brinde exclusivo em compras acima de R$ 150

👉 *Conferir oferta:* ${cfg.recovery_link ?? "[link do carrinho]"}

Essa proposta é válida *até amanhã* — depois muda!

Bora finalizar? 🚀`,
};

function buildRecoveryLink(checkoutReturnUrl?: string | null, sessionId?: string): string {
  const base = checkoutReturnUrl || process.env.PUBLIC_WIDGET_URL || "https://widget.aacp.com/checkout";
  if (!sessionId) return base;
  const params = new URLSearchParams({ sessionId });
  return `${base}?${params.toString()}`;
}

@ApiTags("Cart Recovery")
@Controller("cart-recovery")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class CartRecoveryController {
  constructor(
    private readonly getRecoveryMetrics: GetRecoveryMetricsUseCase,
    private readonly getStrategyPreferences: GetStrategyPreferencesUseCase,
    private readonly updateStrategyPreferences: UpdateStrategyPreferencesUseCase,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
  ) {}

  @Get("metrics")
  @ApiOperation({ summary: "Get recovery metrics and statistics" })
  @ApiOkResponse({ description: "Recovery metrics retrieved" })
  async getMetrics(
    @Req() req: any,
    @Query() query?: { daysBack?: number },
  ) {
    const user = currentUser(req);
    const daysBack = query?.daysBack ?? 30;
    const to = new Date();
    const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return this.getRecoveryMetrics.execute({
      merchantId: user.merchantId,
      from,
      to,
    });
  }

  @Get("attempts")
  @ApiOperation({ summary: "List recovery attempts" })
  @ApiOkResponse({ description: "Recovery attempts retrieved" })
  async listAttempts(
    @Req() req: any,
    @Query() query?: { status?: string; limit?: number; offset?: number },
  ) {
    const user = currentUser(req);
    const status = query?.status ?? "all";
    const limit = Math.min(query?.limit ?? 50, 100);
    const offset = query?.offset ?? 0;
    return {
      merchantId: user.merchantId,
      status,
      limit,
      offset,
      message: "Recovery attempts endpoint",
    };
  }

  @Get("strategies")
  @ApiOperation({ summary: "Get cart recovery strategy toggles" })
  @ApiOkResponse({ description: "Strategy preferences retrieved" })
  async getStrategies(@Req() req: any) {
    const user = currentUser(req);
    const strategies = await this.getStrategyPreferences.execute({
      merchantId: user.merchantId,
    });
    return { strategies };
  }

  @Patch("strategies")
  @ApiOperation({ summary: "Update cart recovery strategy toggles" })
  @ApiOkResponse({ description: "Strategy preferences updated" })
  async patchStrategies(
    @Req() req: any,
    @Body() body: { strategies?: Record<string, boolean> },
  ) {
    const user = currentUser(req);
    const strategies = await this.updateStrategyPreferences.execute({
      merchantId: user.merchantId,
      strategies: body?.strategies ?? {},
    });
    return { strategies };
  }

  @Post("test-send")
  @ApiOperation({ summary: "Send a test WhatsApp recovery message" })
  @ApiOkResponse({ description: "Test message sent" })
  async testSend(
    @Req() req: any,
    @Body() body: {
      phone: string;
      strategy: string;
      coupon_code?: string;
      rule_id?: string;
      session_id?: string;
      cart_ref?: string;
    },
  ) {
    const user = currentUser(req);
    const recoveryLink = buildRecoveryLink(null, body.session_id);

    const templateFn = TEMPLATES[body.strategy] ?? TEMPLATES.offer_coupon;
    const message = templateFn({
      coupon_code: body.coupon_code,
      rule_id: body.rule_id,
      recovery_link: recoveryLink,
    });

    await this.whatsappSender.send({ phone: body.phone, message });

    return {
      sent: true,
      phone: body.phone,
      strategy: body.strategy,
      recovery_link: recoveryLink,
      message_preview: message,
    };
  }
}