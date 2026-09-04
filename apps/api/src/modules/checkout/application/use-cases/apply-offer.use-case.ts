import { Inject, Injectable, NotFoundException, Optional , Logger} from "@nestjs/common";
import type {
  ApplyOfferRequest,
  ApplyOfferResponse,
  AuthorizedOffer,
  CheckoutSession,
  ChatTurn
} from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY, type OfferRepository } from "../../domain/ports/offer.repository.port.js";
import { COMMERCE_OFFER_PORT, type CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import { AcceptCheckoutOfferUseCase } from "./accept-checkout-offer.use-case.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../domain/checkout-experience.config.js";
import { TenantBoundaryGuard } from "../../domain/services/tenant-boundary.guard.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ApplyOfferUseCase {
  private readonly logger = new Logger(ApplyOfferUseCase.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OFFER_REPOSITORY) private readonly offers: OfferRepository,
    @Inject(COMMERCE_OFFER_PORT) private readonly commerce: CommerceOfferPort,
    private readonly acceptCheckoutOffer: AcceptCheckoutOfferUseCase,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 }
  ) {}

  async execute(input: ApplyOfferRequest): Promise<ApplyOfferResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const offer = await this.offers.getOffer(input.merchant_id, input.offer_id);
    if (!offer || !offer.approved) return { success: false, reason: "offer_not_found_or_not_approved" };
    // Tenant boundary guard: reject cross-merchant offer reuse.
    // This enforces the invariant that offers are scoped to (merchantId, sessionId) tuples.
    if (!TenantBoundaryGuard.matches(offer.merchantId, input.merchant_id)) {
      return { success: false, reason: "offer_not_found_or_not_approved" };
    }
    // Invariant: an offer is scoped to the session it was authorized for.
    // Reject cross-session reuse even within the same merchant.
    if (offer.sessionId !== input.session_id) return { success: false, reason: "offer_not_found_or_not_approved" };
    if (Date.parse(offer.expiresAt) <= Date.now()) return { success: false, reason: "offer_expired" };

    const applied = await this.commerce.apply(offer);
    if (!applied.success) {
      return {
        ...applied,
        expires_at: offer.expiresAt
      };
    }

    await this.acceptCheckoutOffer.execute(input);

    const updatedSession = applyOfferToSession(session, offer);
    await this.sessions.saveSession(updatedSession);

    const followUp = buildAgentFollowUp(offer);
    const sessionWithTurn = await this.sessions.appendChatTurn(input.merchant_id, input.session_id, followUp);

    const merchant = await this.merchantRepo?.getProfile(input.merchant_id);
    const merchantRules = await this.merchantRepo?.getRules(input.merchant_id);
    const experience = buildExperienceFromSession(sessionWithTurn, {
      merchantName: merchant?.name,
      theme: merchant?.theme,
      couponBoxEnabled: merchantRules?.couponBoxEnabled,
      serviceFee: this.experienceConfig.platformFeeBrl
    });

    const subtotal = experience.totals.subtotal;
    const discount = experience.totals.discount;
    // new_total is the full computed total (subtotal + shipping - discount), not
    // subtotal minus discount — that would omit shipping.
    return {
      ...applied,
      new_total: experience.totals.total,
      expires_at: offer.expiresAt,
      experience,
      agent_turn: followUp
    };
  }
}

function applyOfferToSession(session: CheckoutSession, offer: AuthorizedOffer): CheckoutSession {
  const cart = { ...session.cart };
  const shipping = session.shipping ? { ...session.shipping } : undefined;
  if (offer.type === "discount_percent") {
    const previous = cart.currentDiscount ?? 0;
    const newDiscount = roundMoney(cart.total * (offer.value / 100));
    cart.currentDiscount = Math.max(previous, newDiscount);
  } else if (offer.type === "shipping_free" && shipping) {
    shipping.customerPrice = 0;
  } else if (offer.type === "shipping_discount_fixed" && shipping) {
    shipping.customerPrice = Math.max(0, roundMoney((shipping.customerPrice ?? 0) - offer.value));
  } else if (offer.type === "discount_fixed") {
    const previous = cart.currentDiscount ?? 0;
    cart.currentDiscount = Math.max(previous, roundMoney(offer.value));
  }
  return {
    ...session,
    cart,
    shipping,
    updatedAt: new Date().toISOString()
  };
}

function buildAgentFollowUp(offer: AuthorizedOffer): ChatTurn {
  const label =
    offer.type === "discount_percent"
      ? `${offer.value}% de desconto`
      : offer.type === "discount_fixed"
        ? `R$${offer.value.toFixed(2)} de desconto`
        : offer.type === "shipping_free"
          ? "frete grátis"
          : `R$${offer.value.toFixed(2)} de redução no frete`;
  return {
    role: "agent",
    text: `Pronto! Apliquei ${label}. Vamos para o pagamento — prefere PIX ou cartão de crédito?`,
    occurredAt: new Date().toISOString(),
    authorizedOfferId: offer.id
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
