import { Injectable } from "@nestjs/common";
import type { CarrierPort, ShippingContext } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";

@Injectable()
export class FlatRateCarrierAdapter implements CarrierPort {
  readonly carrierKey = "flat-rate";

  async fetchQuotes(_ctx: ShippingContext): Promise<ShippingQuoteResult[]> {
    return [
      { carrier_key: "correios-pac-estimate", label: "Correios PAC", price: 1990, eta_days: 7, is_free: false },
      { carrier_key: "correios-sedex-estimate", label: "Correios Sedex", price: 2990, eta_days: 3, is_free: false },
      { carrier_key: "transportadora-standard-estimate", label: "Transportadora Parceira", price: 2490, eta_days: 5, is_free: false }
    ];
  }
}
