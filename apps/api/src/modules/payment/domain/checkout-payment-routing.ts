import type { MerchantStoreSettings } from "../../merchant/domain/merchant.types.js";

export type CheckoutPaymentProvider = "asaas" | "mercadopago" | "stripe";
export type CheckoutPaymentMethod = "pix" | "boleto" | "card";

export type CheckoutPaymentCapabilities = {
  pix: boolean;
  boleto: boolean;
  card: boolean;
  /** The provider actually selected for each advertised method. */
  providers?: Partial<Record<CheckoutPaymentMethod, CheckoutPaymentProvider>>;
};

export type CheckoutRouteAvailability = {
  asaas: boolean;
  mercadoPagoPix: boolean;
  /** Checkout Pro hosted by Mercado Pago; no card data enters Zyon. */
  mercadoPagoHostedCard: boolean;
  stripeCard: boolean;
  /** Asaas card is completed on the provider-hosted invoice, never with PAN/CVV in Zyon. */
  asaasHostedCard: boolean;
};

/**
 * Resolves one provider per method. An explicit merchant choice is authoritative:
 * if that provider is not ready, hide the method rather than silently charging
 * through another provider. The no-preference order preserves the existing flow.
 */
export function resolveCheckoutPaymentCapabilities(
  routing: MerchantStoreSettings["paymentRouting"] | undefined,
  available: CheckoutRouteAvailability,
): CheckoutPaymentCapabilities {
  const select = <T extends CheckoutPaymentMethod>(
    method: T,
    candidates: Array<CheckoutPaymentProvider>,
  ): CheckoutPaymentProvider | undefined => {
    const configured = routing?.[method] as CheckoutPaymentProvider | undefined;
    if (configured) return candidates.includes(configured) ? configured : undefined;
    return candidates[0];
  };

  const pixCandidates: CheckoutPaymentProvider[] = [
    ...(available.mercadoPagoPix ? ["mercadopago" as const] : []),
    ...(available.asaas ? ["asaas" as const] : []),
  ];
  const boletoCandidates: CheckoutPaymentProvider[] = available.asaas ? ["asaas"] : [];
  const cardCandidates: CheckoutPaymentProvider[] = [
    ...(available.stripeCard ? ["stripe" as const] : []),
    ...(available.asaasHostedCard ? ["asaas" as const] : []),
    ...(available.mercadoPagoHostedCard ? ["mercadopago" as const] : []),
  ];

  const pix = select("pix", pixCandidates);
  const boleto = select("boleto", boletoCandidates);
  const card = select("card", cardCandidates);
  const providers: Partial<Record<CheckoutPaymentMethod, CheckoutPaymentProvider>> = {};
  if (pix) providers.pix = pix;
  if (boleto) providers.boleto = boleto;
  if (card) providers.card = card;

  return {
    pix: Boolean(pix),
    boleto: Boolean(boleto),
    card: Boolean(card),
    ...(Object.keys(providers).length ? { providers } : {}),
  };
}
