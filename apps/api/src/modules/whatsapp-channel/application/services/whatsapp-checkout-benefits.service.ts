import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { CheckoutCommercialBenefitsService } from "../../../cashback/application/checkout-commercial-benefits.service.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";
import { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import { ApplyOfferUseCase } from "../../../checkout/application/use-cases/apply-offer.use-case.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../../checkout/domain/checkout-experience.config.js";
import { DEFAULT_PLATFORM_FEE_BRL } from "../../../../shared/config/platform-fee.config.js";

export function parseWhatsAppBenefitCommand(message: string): { kind: "coupon"; code: string } | { kind: "offer" } | null {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/[!?]+$/, "").trim();
  const coupon = text.match(/^(?:aplicar|aplique|usar|use|utilizar) (?:o )?cupom ([A-Z0-9_-]{1,64})$/i);
  if (coupon) return { kind: "coupon", code: coupon[1]!.toUpperCase() };
  return /^(?:aplicar|aplique|aceitar|aceito) (?:a )?oferta$/i.test(text) ? { kind: "offer" } : null;
}

@Injectable()
export class WhatsAppCheckoutBenefitsService {
  constructor(private readonly benefits: CheckoutCommercialBenefitsService, private readonly cashback: CashbackService,
    private readonly coupons: ApplyCouponUseCase, private readonly offers: ApplyOfferUseCase,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Optional() @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly config: CheckoutExperienceConfig = { platformFeeBrl: DEFAULT_PLATFORM_FEE_BRL }) {}

  async respond(session: CheckoutSession, message: string) {
    const command = parseWhatsAppBenefitCommand(message);
    if (!command || !await this.benefits.hasCombination(session)) return null;
    try {
      let current = session;
      if (command.kind === "coupon") {
        const applied = await this.coupons.executeForCheckout({ merchant_id: session.merchantId, session_id: session.sessionId,
          code: command.code, expectedVersion: session.persistenceVersion });
        current = applied.session;
      } else {
        const offerId = [...session.chatHistory].reverse().find(turn => turn.role === "agent" && typeof turn.authorizedOfferId === "string")?.authorizedOfferId;
        if (!offerId) return { agentMessage: "Não encontrei uma oferta disponível neste pedido. Peça uma nova condição à loja.", quickReplies: ["Meu saldo de cashback", "Continuar compra"] };
        const result = await this.offers.execute({ merchant_id: session.merchantId, session_id: session.sessionId, offer_id: offerId });
        if (!result.success || !result.experience) throw new Error("checkout_offer_not_applied");
        return this.describe(result.experience, "Oferta aplicada");
      }
      const [rules, merchant, cashbackCents] = await Promise.all([this.merchants.getRules(session.merchantId),
        this.merchants.getProfile(session.merchantId), this.cashback.checkoutCashbackCents(current)]);
      return this.describe(buildExperienceFromSession(current, { rules, merchantName: merchant?.name,
        serviceFee: this.config.platformFeeBrl, cashbackCents }), `Cupom ${command.code} aplicado`);
    } catch {
      return { agentMessage: "Não consegui confirmar a aplicação desse benefício. Confira as condições da loja e consulte o saldo antes de continuar.",
        quickReplies: ["Meu saldo de cashback", "Continuar compra"] };
    }
  }

  private describe(experience: ReturnType<typeof buildExperienceFromSession>, title: string) {
    const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const t = experience.totals;
    const lines = experience.items.map(item => `${item.quantity} × ${item.name}`);
    return { agentMessage: [title + ".", ...lines, `Produtos: ${money(t.subtotal)}. Descontos: ${money(t.discount)}.`,
      `Cashback: ${money((t.cashback_cents ?? 0) / 100)}. Frete: ${money(t.shipping ?? 0)}.`,
      `Taxa de serviço: ${money(t.service_fee ?? 0)}. Total a pagar: ${money(t.total_to_pay ?? t.total)}.`].join("\n"),
      quickReplies: ["Meu saldo de cashback", "Usar cashback", "Continuar compra"] };
  }
}
