import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CheckoutSession, CustomerHints, ShippingQuote } from "@aacp/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { estimatePacQuote, lookupAddressByViaCep } from "../../domain/services/viacep-lookup.service.js";
import { extractAddressDetailLine } from "../../domain/services/customer-extraction.service.js";
import { CheckoutCustomerService } from "./checkout-customer.service.js";
import { HttpClientService } from "../../../../shared/http/http-client.service.js";

@Injectable()
export class CheckoutShippingService {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly repository: CheckoutSessionRepository,
    private readonly customerService: CheckoutCustomerService,
    @Optional() private readonly http?: HttpClientService
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

    if (!addr.number) {
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
    const q = estimatePacQuote({ zip: addr.zip, state: addr.state });
    const sedexPrice = Math.round((q.customerPrice + 10) * 100) / 100;
    const sedexRealCost = Math.round((q.realCost + 8) * 100) / 100;
    const next: CheckoutSession = {
      ...session,
      shippingOptions: [
        {
          customerPrice: q.customerPrice,
          realCost: q.realCost,
          carrier: q.carrier,
          method: "PAC",
          deliveryDays: q.deliveryDays,
          region: q.region,
          destinationZip: q.destinationZip
        },
        {
          customerPrice: sedexPrice,
          realCost: sedexRealCost,
          carrier: "Correios (estimativa)",
          method: "Sedex",
          deliveryDays: Math.max(1, q.deliveryDays - 2),
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

    if (/\b(1|primeir[ao]|pac|economi[ac]|barat[ao])\b/.test(normalized)) {
      return this.findOption(options, /pac|econom/i) ?? options[0] ?? null;
    }
    if (/\b(2|segund[ao]|sedex|express|rapid[ao])\b/.test(normalized)) {
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
