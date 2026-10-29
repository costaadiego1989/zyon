import { ConflictException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { hasMarketplaceCheckout } from "../../infrastructure/marketplace-checkout-scope.js";
import { hasPreparedCheckoutPayment } from "../../infrastructure/checkout-payment-scope.js";
import { requiresPhysicalDelivery } from "../../domain/services/cart-fulfillment.js";
import { checkoutShippingInput, checkoutShippingOption } from "../../../shipping/application/checkout-shipping-quote.js";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { CheckoutSession, CustomerHints, PackageDimensions, ShippingQuote } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { lookupAddressByViaCep } from "../../domain/services/viacep-lookup.service.js";
import { extractAddressDetailLine, isShippingQuickReplyQuestion } from "../../domain/services/customer-extraction.service.js";
import { CheckoutCustomerService } from "./checkout-customer.service.js";
import { HttpClientService } from "../../../../shared/http/http-client.service.js";
import { QuoteShippingUseCase } from "../../../shipping/application/use-cases/quote-shipping.use-case.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { commitCheckoutMutation } from "./commit-checkout-mutation.js";
import { checkoutShippingLabel } from "../../domain/services/checkout-shipping-label.js";
import { toCheckoutShippingQuote } from "../../../shipping/domain/services/checkout-shipping-quote.mapper.js";
import { deriveChatStage } from "../../domain/services/customer-extraction.service.js";

@Injectable()
export class CheckoutShippingService {
  private readonly logger = new Logger(CheckoutShippingService.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly repository: CheckoutSessionRepository,
    private readonly customerService: CheckoutCustomerService,
    @Optional() private readonly quoteShipping?: QuoteShippingUseCase,
    @Optional() private readonly http?: HttpClientService,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRulesRepo?: MerchantRulesRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient
  ) { }

  /** Use current canonical quotes; an unset/default preference is not consent. */
  async prepareReturningBuyer(session: CheckoutSession, preference?: "cheapest" | "fastest"): Promise<CheckoutSession> {
    if (!requiresPhysicalDelivery(session.cart) || deriveChatStage(session) === "data_collection" ||
      !session.customer?.address_verified || this.prisma && await hasPreparedCheckoutPayment(this.prisma, session)) return session;
    const current = await this.tryEnsureShippingOptions(session);
    if (current.shipping || !preference) return current;
    const valid = (current.shippingOptions ?? []).filter(option => Number.isFinite(option.customerPrice) && option.customerPrice >= 0 &&
      !!option.quoteId && !!option.expiresAt && Date.parse(option.expiresAt) > Date.now() &&
      (preference !== "fastest" || typeof option.deliveryDays === "number" && Number.isFinite(option.deliveryDays) && option.deliveryDays >= 0));
    const eta = (option: ShippingQuote) => option.deliveryDays ?? Infinity;
    valid.sort((a, b) => preference === "fastest" ? eta(a) - eta(b) || a.customerPrice - b.customerPrice
      : a.customerPrice - b.customerPrice || eta(a) - eta(b));
    return valid[0] ? this.trySelectShippingOption(checkoutShippingLabel(valid[0]), current) : current;
  }

  async processShippingState(session: CheckoutSession, userMessage: string): Promise<CheckoutSession> {
    if (!requiresPhysicalDelivery(session.cart)) return session;
    if (session.shipping && this.prisma && await hasPreparedCheckoutPayment(this.prisma, session)) return session;
    let working = structuredClone(session);
    let confirmedAddressThisTurn = false;

    if (working.customer?.address?.street && !working.customer?.address_verified) {
      const normalizedMsg = userMessage.trim().replace(/[.,\/#!?$%\^&\*;:{}=\-_`~()]/g, "").trim();
      const isYes = /^(sim|s|correto|certo|isso|[eé]\s+esse|esse\s+mesmo|esta\s+correto|está\s+correto|confirmado|confirma|confirmo)$/i.test(normalizedMsg);
      const isNo = /^(nao|não|n|errado|esta\s+errado|está\s+errado|rejeitado|rejeito)$/i.test(normalizedMsg);
      if (isYes) {
        confirmedAddressThisTurn = true;
        working = await commitCheckoutMutation(this.repository, { expected: working,
          next: this.customerService.mergeCustomers(working, { address_verified: true }) });
      } else if (isNo) {
        working = await commitCheckoutMutation(this.repository, { expected: working, next: this.customerService.mergeCustomers(working, {
          address: {
            zip: undefined,
            street: undefined,
            number: undefined,
            complement: undefined,
            neighborhood: undefined,
            city: undefined,
            state: undefined
          },
          address_verified: false
        }) });
        return working;
      } else {
        // neither yes nor no — stay in confirmation state, do not process as address data
        return working;
      }
    }

    working = await this.tryFillPostalAndShipping(working);

    // A yes/no answer cannot also become an address number or complement.
    const numberPatch = confirmedAddressThisTurn ? null : this.tryParseAddressNumbers(userMessage, working);
    if (numberPatch) {
      working = await commitCheckoutMutation(this.repository, { expected: working,
        next: this.customerService.mergeCustomers(working, numberPatch) });
    }

    const priorQuote = working.shippingOptions?.[0]?.quoteId;
    const hadOptions = !!working.shippingOptions?.length;
    working = await this.tryEnsureShippingOptions(working);
    if (hadOptions && priorQuote === working.shippingOptions?.[0]?.quoteId) working = await this.trySelectShippingOption(userMessage, working);

    return working;
  }

  private async tryFillPostalAndShipping(session: CheckoutSession): Promise<CheckoutSession> {
    const zip = session.customer?.address?.zip?.replace(/\D/g, "");
    const beforeStreet = session.customer?.address?.street;
    if (zip?.length === 8 && !beforeStreet) {
      const via = await lookupAddressByViaCep(zip, this.http?.toFetch());
      if (via) {
        const next = this.customerService.mergeCustomers(session, {
          address: this.customerService.mergeAddr(session.customer?.address, via)
        });
        return commitCheckoutMutation(this.repository, { expected: session, next });
      }
    }
    return session;
  }

  private tryParseAddressNumbers(text: string, session: CheckoutSession): Partial<CustomerHints> | null {
    const addr = session.customer?.address ?? {};
    if (!addr.street || !addr.zip) return null;
    if (isShippingQuickReplyQuestion(text)) return null;

    if (!addr.number) {
      const noNumberPhrase = /n[aã]o\s+tem\s+n[uú]mero|n[aã]o\s+h[aá]\s+n[uú]mero|casa\s+n[aã]o\s+tem\s+n[uú]mero|endere[cç]o\s+sem\s+n[uú]mero/i;
      if (noNumberPhrase.test(text)) {
        return { address: { ...addr, number: "S/N" } };
      }
      const ln = extractAddressDetailLine(text);
      if (!ln?.number) return null;
      return { address: { ...addr, number: ln.number, complement: ln.complement } };
    }

    if (addr.complement === undefined) {
      const isNone = /^(n[ãa]o(\s+tem)?|nada|sem(\s+complemento)?|nenhum)$/i.test(text.trim());
      const complementStr = isNone ? "" : text.trim().slice(0, 160);
      return { address: { ...addr, complement: complementStr } };
    }

    return null;
  }

  private async tryEnsureShippingOptions(session: CheckoutSession): Promise<CheckoutSession> {
    if (await this.isMarketplace(session)) return this.currentSession(session);
    const addr = session.customer?.address;
    if (addr?.zip && this.quoteShipping && (session.shipping || session.shippingOptions?.length) && typeof this.quoteShipping.quoteKey === "function") {
      const key = await this.quoteShipping.quoteKey(checkoutShippingInput(session));
      const options = session.shipping ? [session.shipping] : session.shippingOptions ?? [];
      if (options.some(option => option.quoteKey !== key || !option.expiresAt || Date.parse(option.expiresAt) <= Date.now())) {
        session = await commitCheckoutMutation(this.repository, { expected: session, next: { ...session, shipping: undefined, shippingOptions: [], updatedAt: new Date().toISOString() } });
      }
    }
    if (
      !addr?.zip ||
      !addr?.street ||
      !addr.city ||
      !addr.state ||
      !addr.number ||
      addr.complement === undefined ||
      session.shipping ||
      (session.shippingOptions?.length ?? 0) > 0
    ) {
      return session;
    }

    // Try live quotes from MelhorEnvio via QuoteShippingUseCase
    if (this.quoteShipping) {
      let shippingOptions: ShippingQuote[] | undefined;
      try {
        const quoteSnapshot = await this.quoteShipping.execute(checkoutShippingInput(session));
        if (quoteSnapshot.results.length > 0) {
          shippingOptions = quoteSnapshot.results.map(result => checkoutShippingOption(quoteSnapshot, result));
        }
      } catch (err) {
        if (this.isMarketplaceShippingDenial(err)) return this.currentSession(session);
        if (err instanceof Error && err.message === "marketplace_checkout_scope_unavailable") throw err;
        this.logger.warn("shipping.quote.unavailable", { merchantId: session.merchantId, reason: err instanceof Error ? err.message : "shipping_unavailable" });
      }
      if (shippingOptions) {
        if (await this.isMarketplace(session)) return this.currentSession(session);
        return commitCheckoutMutation(this.repository, { expected: session,
          next: { ...session, shippingOptions, updatedAt: new Date().toISOString() } });
      }
    }

    // An unavailable provider must never turn into a purchasable invented price.
    return session;
  }

  private async trySelectShippingOption(text: string, session: CheckoutSession): Promise<CheckoutSession> {
    if (session.shipping || !session.shippingOptions?.length) return session;
    // Guard: don't auto-select when complement hasn't been defined yet.
    // This prevents the address number (e.g. "1") from matching the shipping regex
    // in the same turn where options were just generated.
    if (session.customer?.address?.complement === undefined) return session;
    // Guard: don't auto-select if text looks like an address complement
    // (e.g. "Apto 204", "Bloco B", "Casa 3") — prevents false regex matches.
    if (!text.trim().startsWith("Entrega ·") && this.looksLikeAddressComplement(text)) return session;
    const selected = this.selectShippingOption(text, session.shippingOptions);
    if (!selected) return session;
    await this.quoteShipping?.assertNeighborhoodDestination?.(session, selected);
    const next = await commitCheckoutMutation(this.repository, { expected: session, next: {
      ...session,
      shipping: selected,
      updatedAt: new Date().toISOString()
    } });
    // Intent Memory signal: a shipping-option selection is a buyer behaviour
    // signal the intent classifier consumes. Non-blocking — never break the
    // shipping flow if event recording fails.
    try {
      await this.repository.recordEvent(next.merchantId, next.sessionId, "shipping_option_selected", {
        carrier: selected.carrier,
        method: selected.method,
        customerPrice: selected.customerPrice,
      });
    } catch (err) {
      this.logger.warn("shipping_option_selected.record_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Recording the event updates the session too. Continue with its current
    // snapshot, including any concurrent cart invalidation; never reapply the
    // old selected quote over a newer cart or carry a stale persistence token.
    return await this.repository.getSession(next.merchantId, next.sessionId) ?? next;
  }

  private async isMarketplace(session: CheckoutSession): Promise<boolean> {
    if (!this.prisma) throw new ConflictException("marketplace_checkout_scope_unavailable");
    return hasMarketplaceCheckout(this.prisma, { merchantId: session.merchantId, sessionId: session.sessionId, session });
  }

  private isMarketplaceShippingDenial(error: unknown): boolean {
    return error instanceof Error && error.message === "marketplace_shipping_selection_required";
  }

  private async currentSession(session: CheckoutSession): Promise<CheckoutSession> {
    return await this.repository.getSession(session.merchantId, session.sessionId) ?? session;
  }

  private selectShippingOption(text: string, options: ShippingQuote[]): ShippingQuote | null {
    const normalize = (value: string) => value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase().trim();

    // A button identifies the complete server label. Never reinterpret a stale
    // or ambiguous button as a fuzzy carrier match or a numbered option.
    // Read the marker first: Unicode's Diacritic property also includes '·'.
    if (text.trim().startsWith("Entrega ·")) {
      const label = normalize(text.trim().slice("Entrega ·".length));
      if (!label) return null;
      const matches = options.filter(option => normalize([option.carrier, option.method].filter(Boolean).join(" ")) === label);
      return matches.length === 1 ? matches[0]! : null;
    }

    const normalized = normalize(text);
    const exact = options.filter(option => normalize(checkoutShippingLabel(option)) === normalized);
    if (exact.length) return exact.length === 1 ? exact[0]! : null;
    // A priced quick reply must never fall through to the first PAC/Sedex.
    // Reject a stale label after a quote/price change instead of changing its cost.
    if (/R\$|\(\d+\s+dias\)/i.test(text)) return null;
    if (/\b(mais barato|mais barata|mais economico|mais economica)\b/.test(normalized)) {
      return [...options].sort((a, b) => a.customerPrice - b.customerPrice
        || (a.deliveryDays ?? Infinity) - (b.deliveryDays ?? Infinity))[0] ?? null;
    }
    if (/\b(mais rapido|mais rapida)\b/.test(normalized)) {
      return [...options].filter(quote => Number.isFinite(quote.deliveryDays)).sort((a, b) => a.deliveryDays! - b.deliveryDays!
        || a.customerPrice - b.customerPrice)[0] ?? null;
    }
    if (/^(?:opcao\s+)?(?:1|primeir[ao])$/.test(normalized)) {
      return options[0] ?? null;
    }
    if (/^(?:opcao\s+)?(?:2|segund[ao])$/.test(normalized)) {
      return options[1] ?? null;
    }

    // Manual delivery labels are not a fuzzy intent. A generic "ver entregas"
    // must not become acceptance of the only local method. Existing exact
    // labels/buttons, numbered choices and explicit cheaper/faster still work.
    const manual = (option: ShippingQuote) => normalize(option.carrier ?? "") === "entrega"
      && this.normalizeShippingToken(option.method) === "propria";
    const methodMatches = options.filter(option => {
      if (manual(option)) return false;
      const method = this.normalizeShippingToken(option.method);
      return method && normalized.includes(method);
    });
    const matches = methodMatches.length ? methodMatches : options.filter(option => {
      if (manual(option)) return false;
      const carrier = this.normalizeShippingToken(option.carrier);
      return carrier && normalized.includes(carrier);
    });
    return matches.length === 1 ? matches[0]! : null;
  }

  private looksLikeAddressComplement(text: string): boolean {
    const normalized = text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();
    // Matches common address complement patterns: "Apto 204", "Bloco B", "Casa 3", etc.
    return /\b(apto|apartamento|bloco|bl|casa|sala|loja|andar|fundos|cobertura|sobrado)\b/.test(normalized);
  }

  private normalizeShippingToken(value: string | undefined): string {
    return (value ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .split(/\s+/)[0] ?? "";
  }

  summarizeDelivery(session: CheckoutSession): string | undefined {
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
}
