import { Injectable, BadRequestException } from "@nestjs/common";
import { validateCep, validatePackagesList } from "@zyon/shipping-engine";
import type { PackageDimensions } from "@zyon/shared-types";
import type { CarrierPort, ShippingContext } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import type { ShippingCarrierPort, LabelPurchaseInput, LabelPurchaseResult, TrackingResult } from "../../domain/ports/shipping-carrier.port.js";
import type { MelhorEnvioTokenResolver } from "../../domain/ports/melhor-envio-token-resolver.port.js";
import { melhorEnvioBaseUrl } from "../melhor-envio-config.js";
import { carrierQuoteSnapshot } from "../../domain/marketplace-shipment-journal.js";
import { marketplaceShippingContractHash } from "../../domain/marketplace-shipping-contract.js";
import { readMelhorEnvioAccountIdentity } from "./melhor-envio-account-identity.js";

interface MelhorEnvioService {
  id: number;
  name: string;
  price: string;
  custom_price?: string;
  currency: string;
  delivery_time: number;
  custom_delivery_time?: number;
  company: { name: string };
  packages?: unknown;
}

@Injectable()
export class MelhorEnvioCarrierAdapter implements CarrierPort, ShippingCarrierPort {
  readonly carrierKey = "melhor-envio";

  constructor(private readonly tokenResolver: MelhorEnvioTokenResolver) {}

  private get baseUrl(): string { return melhorEnvioBaseUrl(); }
  private get fromZip(): string { return process.env.MELHOR_ENVIO_FROM_ZIP ?? ""; }

  async fetchQuotes(ctx: ShippingContext & { insuranceProducts?: Array<{ id: string; unitValueCents: number }> },
    options?: { requireMerchantAccount?: boolean }): Promise<ShippingQuoteResult[]> {
    const token = await this.tokenResolver.resolveToken(ctx.merchantId, options?.requireMerchantAccount ? { allowPlatformFallback: false } : undefined);
    if (!token || !ctx.destinationZip) return [];

    const fromZipRaw = ctx.originZip || (options?.requireMerchantAccount ? "" : this.fromZip);
    if (!fromZipRaw) return [];

    const toZipResult = validateCep(ctx.destinationZip);
    const fromZipResult = validateCep(fromZipRaw);
    if (!toZipResult.valid || !fromZipResult.valid) return [];

    const toZip = toZipResult.normalized!;
    const fromZip = fromZipResult.normalized!;

    const packagesResult = validatePackagesList(ctx.packages);
    if (!packagesResult.valid) {
      throw new BadRequestException(`shipping_packages_invalid:${packagesResult.reason}`);
    }

    if (ctx.insuranceProducts !== undefined && (!Array.isArray(ctx.insuranceProducts) || ctx.insuranceProducts.length !== ctx.packages.length ||
        ctx.insuranceProducts.some(row => !row || typeof row.id !== "string" || !row.id.trim() ||
          !Number.isSafeInteger(row.unitValueCents) || row.unitValueCents <= 0 || row.unitValueCents > 2_147_483_647) ||
        new Set(ctx.insuranceProducts.map(row => row.id)).size !== ctx.insuranceProducts.length ||
        ctx.packages.some(row => !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 99) ||
        !Number.isSafeInteger(ctx.insuranceProducts.reduce((sum, row, index) => sum + row.unitValueCents * ctx.packages[index].quantity, 0)) ||
        ctx.insuranceProducts.reduce((sum, row, index) => sum + row.unitValueCents * ctx.packages[index].quantity, 0) > 2_147_483_647)) {
      throw new BadRequestException("shipping_insurance_invalid");
    }
    const products = (packagesResult.normalized as PackageDimensions[]).map((p, index) => ({
      ...(ctx.insuranceProducts ? { id: ctx.insuranceProducts[index].id, insurance_value: ctx.insuranceProducts[index].unitValueCents / 100 } : {}),
      weight: p.weightKg,
      width: p.widthCm,
      height: p.heightCm,
      length: p.lengthCm,
      quantity: p.quantity
    }));

    const body = {
      from: { postal_code: fromZip },
      to: { postal_code: toZip },
      products,
      options: { receipt: false, own_hand: false },
      services: "1,2,17,18"
    };

    try {
      const accountIdentity = options?.requireMerchantAccount ? await readMelhorEnvioAccountIdentity({
        base: this.baseUrl, token, originMerchantId: ctx.merchantId }) : undefined;
      const response = await fetch(`${this.baseUrl}/api/v2/me/shipment/calculate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json",
          "User-Agent": "AACP/1.0 (checkout@aacp.com)"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
        redirect: "error"
      });

      if (!response.ok) return [];

      const services: MelhorEnvioService[] = await response.json() as MelhorEnvioService[];
      if (!Array.isArray(services)) return [];
      if (accountIdentity) {
        const currentToken = await this.tokenResolver.resolveToken(ctx.merchantId, { allowPlatformFallback: false });
        if (!currentToken || marketplaceShippingContractHash(await readMelhorEnvioAccountIdentity({
          base: this.baseUrl, token: currentToken, originMerchantId: ctx.merchantId })) !== marketplaceShippingContractHash(accountIdentity)) return [];
      }

      return services.flatMap((s) => {
        const price = decimalPriceCents(s?.custom_price ?? s?.price);
        const days = s?.custom_delivery_time ?? s?.delivery_time;
        if (!s || !["BRL", "R$"].includes(s.currency) || price === null || !Number.isSafeInteger(s.id) || s.id <= 0 ||
            !Number.isSafeInteger(days) || days < 0 || !s.name?.trim() || !s.company?.name?.trim()) return [];
        return [{
          carrier_key: `melhor-envio-${s.id}`,
          currency: "BRL",
          label: `${s.company.name} ${s.name}`,
          price,
          eta_days: days,
          is_free: price === 0,
          ...(options?.requireMerchantAccount && ctx.insuranceProducts &&
            ["https://sandbox.melhorenvio.com.br", "https://melhorenvio.com.br"].includes(this.baseUrl) ? {
              marketplaceCarrierQuote: carrierQuoteSnapshot({ packages: s.packages,
                environment: this.baseUrl === "https://sandbox.melhorenvio.com.br" ? "test" : "live",
                accountFingerprint: marketplaceShippingContractHash(accountIdentity!), accountIdentity,
                serviceId: s.id, amountCents: price, products: ctx.insuranceProducts.map((row, index) =>
                  ({ ...row, quantity: ctx.packages[index].quantity })) })
            } : {}),
        }];
      });
    } catch {
      return [];
    }
  }

  async purchaseLabel(input: LabelPurchaseInput): Promise<LabelPurchaseResult> {
    const token = await this.resolveTokenOrThrow(input.merchantId);
    const accountIdentity = await readMelhorEnvioAccountIdentity({ base: this.baseUrl, token, originMerchantId: input.merchantId });
    const fromZip = this.normalizeCepOrThrow(input.fromZip || this.fromZip, "from_zip_invalid");
    const toZip = this.normalizeCepOrThrow(input.toZip, "to_zip_invalid");
    const products = this.normalizeProducts(input.packages);

    const cartBody = {
      service: input.serviceId,
      from: {
        postal_code: fromZip,
        name: input.fromName ?? "Zyon Merchant",
        document: input.fromDocument ?? undefined,
      },
      to: {
        postal_code: toZip,
        name: input.toName,
        document: input.toDocument,
      },
      products,
      options: {
        receipt: false,
        own_hand: false,
        invoice: input.invoiceKey ? { key: input.invoiceKey } : undefined,
      },
    };

    const cart = await this.postJson<Record<string, unknown>>("/api/v2/me/cart", cartBody, "melhor_envio_cart_failed", token);
    const cartItemId = this.extractCartItemId(cart);

    const checkout = await this.postJson<Record<string, unknown>>(
      "/api/v2/me/shipment/checkout",
      { orders: [cartItemId] },
      "melhor_envio_checkout_failed",
      token,
    );

    await this.postJson<Record<string, unknown>>(
      "/api/v2/me/shipment/generate",
      { orders: [cartItemId] },
      "melhor_envio_generate_failed",
      token,
    );

    return {
      carrierOrderId: cartItemId,
      accountIdentity,
      purchaseId: extractString(checkout, ["purchase.id", "id", "order_id"]) ?? cartItemId,
      trackingCode: extractString(checkout, ["purchase.tracking", "tracking", "tracking_code"]) ?? cartItemId,
      labelUrl: extractString(checkout, ["purchase.label_url", "label_url", "url"]),
    };
  }

  /** The caller must own a durable cancellation claim. Recovery never posts. */
  async cancelLabel(input: { merchantId: string; carrierOrderId: string;
    accountIdentity: NonNullable<LabelPurchaseResult["accountIdentity"]>; submit: boolean }) {
    const unknown = (reason = "carrier_cancellation_unproven") => ({ status: "unknown" as const, reason, walletRefundStatus: "unproven" as const });
    const validTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.carrierOrderId)) return unknown("carrier_original_order_unproven");
    const auth = async () => {
      const token = await this.tokenResolver.resolveToken(input.merchantId, { allowPlatformFallback: false });
      if (!token || marketplaceShippingContractHash(await readMelhorEnvioAccountIdentity({ base: this.baseUrl,
        token, originMerchantId: input.merchantId })) !== marketplaceShippingContractHash(input.accountIdentity)) {
        throw Error("carrier_original_account_unavailable");
      }
      return token;
    };
    const read = async () => {
      const token = await auth();
      const response = await fetch(`${this.baseUrl}/api/v2/me/orders/${encodeURIComponent(input.carrierOrderId)}`, {
        method: "GET", headers: this.headers(token), signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!response.ok) throw Error("carrier_original_order_unproven");
      const row = await response.json() as Record<string, unknown>;
      if (row.id !== input.carrierOrderId) throw Error("carrier_original_order_unproven");
      return row;
    };
    const canceled = (row: Record<string, unknown>) => row.status === "canceled" && validTime(row.canceled_at);
    const unused = (row: Record<string, unknown>) => row.status === "released" && validTime(row.paid_at) &&
      row.posted_at === null && row.delivered_at === null && row.canceled_at === null && !row.conciliation;
    try {
      let row = await read();
      if (canceled(row)) return { status: "canceled" as const, reason: "carrier_wallet_refund_unproven", walletRefundStatus: "unproven" as const };
      if (!input.submit) return unknown();
      if (!unused(row)) return { status: "not_cancellable" as const, reason: "carrier_label_already_used", walletRefundStatus: "unproven" as const };
      const eligibility = await this.postJson<Record<string, { cancellable?: boolean }>>("/api/v2/me/shipment/cancellable",
        { orders: [input.carrierOrderId] }, "melhor_envio_cancellable_failed", await auth());
      if (eligibility[input.carrierOrderId]?.cancellable !== true) return { status: "not_cancellable" as const,
        reason: "carrier_cancellation_not_allowed", walletRefundStatus: "unproven" as const };
      row = await read();
      if (!unused(row)) return unknown();
      const token = await auth();
      try { await this.postJson("/api/v2/me/shipment/cancel", { order: { id: input.carrierOrderId,
        reason_id: "2", description: "Cancelamento por devolucao aprovada do pedido" } }, "melhor_envio_cancel_failed", token); }
      catch { /* A lost response must be recovered by GET, never another POST. */ }
      row = await read();
      return canceled(row) ? { status: "canceled" as const, reason: "carrier_wallet_refund_unproven", walletRefundStatus: "unproven" as const } : unknown();
    } catch { return unknown(); }
  }

  async getTracking(trackingCode: string, merchantId: string): Promise<TrackingResult> {
    const token = await this.resolveTokenOrThrow(merchantId);
    const code = trackingCode.trim();
    if (!code) throw new BadRequestException("tracking_code_required");

    const query = new URLSearchParams({ tracking: code });
    const response = await fetch(`${this.baseUrl}/api/v2/me/shipment/tracking?${query.toString()}`, {
      method: "GET",
      headers: this.headers(token),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new BadRequestException("melhor_envio_tracking_failed");
    const payload = await response.json() as Record<string, unknown>;
    const entry = payload[code] as Record<string, unknown> | undefined;
    if (!entry) throw new BadRequestException("melhor_envio_tracking_not_found");
    const events = Array.isArray(entry.events)
      ? entry.events.flatMap((raw) => normalizeTrackingEvent(raw))
      : [];
    return {
      status: typeof entry.status === "string" ? entry.status : "unknown",
      events,
    };
  }

  private async resolveTokenOrThrow(merchantId: string): Promise<string> {
    const token = await this.tokenResolver.resolveToken(merchantId);
    if (!token) throw new BadRequestException("melhor_envio_token_missing");
    return token;
  }

  private normalizeCepOrThrow(value: string, error: string): string {
    const result = validateCep(value);
    if (!result.valid || !result.normalized) throw new BadRequestException(error);
    return result.normalized;
  }

  private normalizeProducts(packages: LabelPurchaseInput["packages"]): Array<Record<string, number>> {
    const packagesResult = validatePackagesList(packages);
    if (!packagesResult.valid) {
      throw new BadRequestException(`shipping_packages_invalid:${packagesResult.reason}`);
    }
    return (packagesResult.normalized as PackageDimensions[]).map((p) => ({
      weight: p.weightKg,
      width: p.widthCm,
      height: p.heightCm,
      length: p.lengthCm,
      quantity: p.quantity,
    }));
  }

  private headers(token: string): HeadersInit {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "User-Agent": "AACP/1.0 (checkout@aacp.com)",
    };
  }

  private async postJson<T>(path: string, body: unknown, errorCode: string, token: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new BadRequestException(errorCode);
    return await response.json() as T;
  }

  private extractCartItemId(payload: Record<string, unknown>): string {
    const id = extractString(payload, ["id", "data.id", "order.id"]);
    if (!id) throw new BadRequestException("melhor_envio_cart_missing_order_id");
    return id;
  }
}

function decimalPriceCents(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 2_147_483_647 ? cents : null;
}

function extractString(payload: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    let current: unknown = payload;
    for (const segment of path.split(".")) {
      current = current && typeof current === "object"
        ? (current as Record<string, unknown>)[segment]
        : undefined;
    }
    if (typeof current === "string" && current.trim()) return current.trim();
  }
  return undefined;
}

function normalizeTrackingEvent(raw: unknown): Array<{ status: string; date: string; description: string }> {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : undefined;
  const date = typeof record.date === "string" ? record.date : typeof record.occurred_at === "string" ? record.occurred_at : undefined;
  const description = typeof record.description === "string" ? record.description : typeof record.message === "string" ? record.message : undefined;
  return status && date && description ? [{ status, date, description }] : [];
}
