import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { CheckoutSession, CustomerHints, PackageDimensions, ShippingQuote } from "@aacp/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { estimatePacQuote, lookupAddressByViaCep } from "../../domain/services/viacep-lookup.service.js";
import { extractAddressDetailLine, isShippingQuickReplyQuestion } from "../../domain/services/customer-extraction.service.js";
import { CheckoutCustomerService } from "./checkout-customer.service.js";
import { HttpClientService } from "../../../../shared/http/http-client.service.js";
import { QuoteShippingUseCase } from "../../../shipping/application/use-cases/quote-shipping.use-case.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";

@Injectable()
export class CheckoutShippingService {
  private readonly logger = new Logger(CheckoutShippingService.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly repository: CheckoutSessionRepository,
    private readonly customerService: CheckoutCustomerService,
    @Optional() private readonly quoteShipping?: QuoteShippingUseCase,
    @Optional() private readonly http?: HttpClientService,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRulesRepo?: MerchantRulesRepository
  ) { }

  async processShippingState(session: CheckoutSession, userMessage: string): Promise<CheckoutSession> {
    let working = session;

    if (working.customer?.address?.street && !working.customer?.address_verified) {
      const normalizedMsg = userMessage.trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
      const isYes = /^(sim|s|correto|esta\s+correto|está\s+correto|confirmado|confirma)$/i.test(normalizedMsg);
      const isNo = /^(nao|não|n|errado|esta\s+errado|está\s+errado|rejeitado|rejeito)$/i.test(normalizedMsg);
      if (isYes) {
        working = this.customerService.mergeCustomers(working, { address_verified: true });
        await this.repository.saveSession(working);
      } else if (isNo) {
        working = this.customerService.mergeCustomers(working, {
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
        });
        await this.repository.saveSession(working);
        return working;
      } else {
        // neither yes nor no — stay in confirmation state, do not process as address data
        return working;
      }
    }

    working = await this.tryFillPostalAndShipping(working);

    const numberPatch = this.tryParseAddressNumbers(userMessage, working);
    if (numberPatch) {
      working = this.customerService.mergeCustomers(working, numberPatch);
      await this.repository.saveSession(working);
    }

    working = await this.tryEnsureShippingOptions(working);
    working = await this.trySelectShippingOption(userMessage, working);

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
        await this.repository.saveSession(next);
        return next;
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
    const addr = session.customer?.address;
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
      try {
        const cartTotal = session.cart?.items?.reduce(
          (sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1),
          0
        ) ?? 0;

        // Build PackageDimensions from cart items
        const packages: PackageDimensions[] = (session.cart?.items ?? []).map((item) => ({
          weightKg: item.weight_kg ?? (item.weightGrams ? item.weightGrams / 1000 : 0.3),
          heightCm: item.height_cm ?? 10,
          widthCm: item.width_cm ?? 15,
          lengthCm: item.length_cm ?? 20,
          quantity: item.quantity ?? 1
        }));

        // Fetch merchant's origin zip from rules
        const merchantRules = await this.merchantRulesRepo?.getRules(session.merchantId ?? "");
        const originZip = merchantRules?.originZip ?? "";

        const quoteSnapshot = await this.quoteShipping.execute({
          session_id: session.sessionId,
          merchant_id: session.merchantId ?? "",
          destination_zip: addr.zip.replace(/\D/g, ""),
          cart_total: cartTotal,
          origin_zip: originZip,
          packages
        });

        if (quoteSnapshot.results.length > 0) {
          const shippingOptions: ShippingQuote[] = quoteSnapshot.results.map((r) =>
            toCheckoutShippingQuote({
              label: r.label,
              carrierKey: r.carrier_key,
              priceInCents: r.price,
              isFree: r.is_free,
              etaDays: r.eta_days,
              destinationZip: addr.zip ?? ""
            })
          );

          const next: CheckoutSession = {
            ...session,
            shippingOptions,
            updatedAt: new Date().toISOString()
          };
          await this.repository.saveSession(next);
          return next;
        }
      } catch (err) {
        this.logger.warn("Live shipping quote failed, falling back to estimate", err);
      }
    }

    // Fallback: deterministic estimate based on state/region
    const q = estimatePacQuote({ zip: addr.zip, state: addr.state });
    const sedexPrice = Math.round((q.customerPrice + 10) * 100) / 100;
    const sedexRealCost = Math.round((q.realCost + 8) * 100) / 100;
    const partnerPrice = Math.round((q.customerPrice + 5) * 100) / 100;
    const partnerRealCost = Math.round((q.realCost + 4) * 100) / 100;
    const next: CheckoutSession = {
      ...session,
      shippingOptions: [
        {
          customerPrice: q.customerPrice,
          realCost: q.realCost,
          carrier: "Correios",
          method: "PAC",
          deliveryDays: q.deliveryDays,
          region: q.region,
          destinationZip: q.destinationZip
        },
        {
          customerPrice: sedexPrice,
          realCost: sedexRealCost,
          carrier: "Correios",
          method: "Sedex",
          deliveryDays: Math.max(1, q.deliveryDays - 2),
          region: q.region,
          destinationZip: q.destinationZip
        },
        {
          customerPrice: partnerPrice,
          realCost: partnerRealCost,
          carrier: "Transportadora Parceira",
          method: "Entrega padrao",
          deliveryDays: Math.max(1, q.deliveryDays - 1),
          region: q.region,
          destinationZip: q.destinationZip
        }
      ],
      updatedAt: new Date().toISOString()
    };
    await this.repository.saveSession(next);
    return next;
  }

  private async trySelectShippingOption(text: string, session: CheckoutSession): Promise<CheckoutSession> {
    if (session.shipping || !session.shippingOptions?.length) return session;
    // Guard: don't auto-select when complement hasn't been defined yet.
    // This prevents the address number (e.g. "1") from matching the shipping regex
    // in the same turn where options were just generated.
    if (session.customer?.address?.complement === undefined) return session;
    // Guard: don't auto-select if text looks like an address complement
    // (e.g. "Apto 204", "Bloco B", "Casa 3") — prevents false regex matches.
    if (this.looksLikeAddressComplement(text)) return session;
    const selected = this.selectShippingOption(text, session.shippingOptions);
    if (!selected) return session;
    const next: CheckoutSession = {
      ...session,
      shipping: selected,
      updatedAt: new Date().toISOString()
    };
    await this.repository.saveSession(next);
    return next;
  }

  private selectShippingOption(text: string, options: ShippingQuote[]): ShippingQuote | null {
    const normalized = text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();

    if (/(?<!\d)\b(1|primeir[ao]|pac|economi[ac]|barat[ao])\b(?!\d)/.test(normalized)) {
      return this.findOption(options, /pac|econom/i) ?? options[0] ?? null;
    }
    if (/(?<!\d)\b(2|segund[ao]|sedex|express|rapid[ao])\b(?!\d)/.test(normalized)) {
      return this.findOption(options, /sedex|express|rapid/i) ?? options[1] ?? options[0] ?? null;
    }

    for (const option of options) {
      const method = this.normalizeShippingToken(option.method);
      const carrier = this.normalizeShippingToken(option.carrier);
      if ((method && normalized.includes(method)) || (carrier && normalized.includes(carrier))) {
        return option;
      }
    }

    return null;
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

  private findOption(options: ShippingQuote[], pattern: RegExp): ShippingQuote | null {
    return options.find((option) => pattern.test(`${option.method ?? ""} ${option.carrier ?? ""}`)) ?? null;
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

function toCheckoutShippingQuote(input: {
  label: string;
  carrierKey: string;
  priceInCents: number;
  isFree: boolean;
  etaDays: number;
  destinationZip: string;
}): ShippingQuote {
  const label = input.label.trim();
  const inferred = inferCarrierAndMethod(label, input.carrierKey);
  const price = input.priceInCents / 100;
  return {
    customerPrice: price,
    realCost: input.isFree ? 0 : price,
    carrier: inferred.carrier,
    method: inferred.method,
    deliveryDays: input.etaDays,
    destinationZip: input.destinationZip
  };
}

function inferCarrierAndMethod(label: string, carrierKey: string): { carrier: string; method: string } {
  if (/^correios\s+pac$/i.test(label)) return { carrier: "Correios", method: "PAC" };
  if (/^correios\s+sedex$/i.test(label)) return { carrier: "Correios", method: "Sedex" };
  if (/^transportadora/i.test(label)) return { carrier: "Transportadora Parceira", method: "Entrega padrao" };

  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { carrier: parts[0]!, method: parts.slice(1).join(" ") };

  return {
    carrier: humanizeCarrierKey(carrierKey),
    method: label || "Frete"
  };
}

function humanizeCarrierKey(value: string): string {
  const label = value
    .replace(/[-_]+/g, " ")
    .replace(/\bestimate\b/gi, "")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return label || "Transportadora";
}
