import { Injectable, BadRequestException } from "@nestjs/common";
import { validateCep, validatePackagesList } from "@zyon/shipping-engine";
import type { PackageDimensions } from "@zyon/shared-types";
import type { CarrierPort, ShippingContext } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";

export interface LabelPurchaseInput {
  serviceId: number;
  fromZip: string;
  toZip: string;
  toName: string;
  toDocument: string;
  packages: Array<{ weightKg: number; widthCm: number; heightCm: number; lengthCm: number; quantity: number }>;
  invoiceKey?: string;
  fromName?: string;
  fromDocument?: string;
}

export interface LabelPurchaseResult {
  purchaseId: string;
  trackingCode: string;
  labelUrl?: string;
}

export interface TrackingResult {
  status: string;
  events: Array<{ status: string; date: string; description: string }>;
}

interface MelhorEnvioService {
  id: number;
  name: string;
  price: string;
  currency: string;
  delivery_time: number;
  company: { name: string };
}

@Injectable()
export class MelhorEnvioCarrierAdapter implements CarrierPort {
  readonly carrierKey = "melhor-envio";

  private get token(): string | undefined { return process.env.MELHOR_ENVIO_TOKEN; }
  private get baseUrl(): string { return process.env.MELHOR_ENVIO_BASE_URL ?? "https://sandbox.melhorenvio.com.br"; }
  private get fromZip(): string { return process.env.MELHOR_ENVIO_FROM_ZIP ?? ""; }

  async fetchQuotes(ctx: ShippingContext): Promise<ShippingQuoteResult[]> {
    if (!this.token || !ctx.destinationZip) return [];

    const fromZipRaw = ctx.originZip || this.fromZip;
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

    const products = (packagesResult.normalized as PackageDimensions[]).map((p) => ({
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
      const response = await fetch(`${this.baseUrl}/api/v2/me/shipment/calculate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
          "Accept": "application/json",
          "User-Agent": "AACP/1.0 (checkout@aacp.com)"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) return [];

      const services: MelhorEnvioService[] = await response.json() as MelhorEnvioService[];
      if (!Array.isArray(services)) return [];

      return services
        .filter((s) => s.price && !isNaN(parseFloat(s.price)))
        .map((s) => ({
          carrier_key: `melhor-envio-${s.id}`,
          label: `${s.company.name} ${s.name}`,
          price: Math.round(parseFloat(s.price) * 100),
          eta_days: s.delivery_time,
          is_free: false
        }));
    } catch {
      return [];
    }
  }

  async purchaseLabel(input: LabelPurchaseInput): Promise<LabelPurchaseResult> {
    this.assertConfigured();
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

    const cart = await this.postJson<Record<string, unknown>>("/api/v2/me/cart", cartBody, "melhor_envio_cart_failed");
    const cartItemId = this.extractCartItemId(cart);

    const checkout = await this.postJson<Record<string, unknown>>(
      "/api/v2/me/shipment/checkout",
      { orders: [cartItemId] },
      "melhor_envio_checkout_failed",
    );

    await this.postJson<Record<string, unknown>>(
      "/api/v2/me/shipment/generate",
      { orders: [cartItemId] },
      "melhor_envio_generate_failed",
    );

    return {
      purchaseId: extractString(checkout, ["purchase.id", "id", "order_id"]) ?? cartItemId,
      trackingCode: extractString(checkout, ["purchase.tracking", "tracking", "tracking_code"]) ?? cartItemId,
      labelUrl: extractString(checkout, ["purchase.label_url", "label_url", "url"]),
    };
  }

  async getTracking(trackingCode: string): Promise<TrackingResult> {
    this.assertConfigured();
    const code = trackingCode.trim();
    if (!code) throw new BadRequestException("tracking_code_required");

    const query = new URLSearchParams({ tracking: code });
    const response = await fetch(`${this.baseUrl}/api/v2/me/shipment/tracking?${query.toString()}`, {
      method: "GET",
      headers: this.headers(),
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

  private assertConfigured(): void {
    if (!this.token) throw new BadRequestException("melhor_envio_token_missing");
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

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.token}`,
      "Accept": "application/json",
      "User-Agent": "AACP/1.0 (checkout@aacp.com)",
    };
  }

  private async postJson<T>(path: string, body: unknown, errorCode: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
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
