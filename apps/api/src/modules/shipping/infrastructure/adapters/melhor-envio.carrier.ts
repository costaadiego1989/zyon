import { Injectable } from "@nestjs/common";
import type { CarrierPort, ShippingContext } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";

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
    if (!this.token || !this.fromZip || !ctx.destinationZip) return [];

    const toZip = ctx.destinationZip.replace(/\D/g, "");
    const fromZip = this.fromZip.replace(/\D/g, "");
    if (toZip.length < 8 || fromZip.length < 8) return [];

    const weightKg = Math.max(0.1, (ctx.packages ?? []).reduce((sum, p) => sum + (p.weightKg ?? 0.3), 0));
    const body = {
      from: { postal_code: fromZip },
      to: { postal_code: toZip },
      products: [{ weight: weightKg, width: 15, height: 10, length: 20, quantity: 1 }],
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
}
