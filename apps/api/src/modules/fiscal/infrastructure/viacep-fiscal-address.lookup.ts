import { lookupAddressByViaCep } from "../../checkout/domain/services/viacep-lookup.service.js";
import type { FiscalPostalLookupPort } from "../domain/fiscal-postal-lookup.port.js";

/** Official ViaCEP JSON contract https://viacep.com.br/; fixed HTTPS host and bounded timeout in the shared lookup. */
export class ViaCepFiscalAddressLookup implements FiscalPostalLookupPort {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}
  async lookup(postalCode: string) {
    if (!/^\d{8}$/.test(postalCode)) return null;
    const value = await lookupAddressByViaCep(postalCode, this.fetchFn);
    if (!value?.cityCode || !value.city || !value.state) return null;
    // Domestic ViaCEP addresses are Brazil: NF-e MOC 7.0 E14/E14-20, cPais=1058.
    return { postalCode: value.zip, street: value.street, neighborhood: value.neighborhood, city: value.city,
      state: value.state, cityCode: value.cityCode, countryCode: "1058" };
  }
}
