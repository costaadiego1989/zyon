import { Injectable } from "@nestjs/common";
import type { CarrierPort, ShippingContext } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";

@Injectable()
export class FlatRateCarrierAdapter implements CarrierPort {
  readonly carrierKey = "flat-rate";

  async fetchQuotes(_ctx: ShippingContext): Promise<ShippingQuoteResult[]> {
    return [
      { carrier_key: this.carrierKey, label: "Envio Padrão", price: 1990, eta_days: 7, is_free: false }
    ];
  }
}
