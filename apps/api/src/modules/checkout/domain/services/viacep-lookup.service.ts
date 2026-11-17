import type { CustomerAddress } from "@zyon/shared-types";

/** Resposta brasileira padrão ViaCEP (sem depender na API oficial dos Correios). */
export interface ViaCepLookupResult {
  zip: string;
  street?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export async function lookupAddressByViaCep(cep: string, fetchFn: typeof fetch = fetch): Promise<ViaCepLookupResult | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  const read = async (url: string) => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetchFn(url, { signal: controller.signal });
      if (response.status >= 500 || response.status === 429) throw new Error("postal_provider_unavailable");
      return response.ok ? await response.json() : null;
    } finally {
      globalThis.clearTimeout(timer);
    }
  };
  try {
    const url = `https://viacep.com.br/ws/${digits}/json/`;
    const raw = (await read(url)) as {
      erro?: boolean | string;
      logradouro?: string;
      complemento?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    } | null;
    if (!raw) return null;
    if (raw.erro === true || raw.erro === "true") return null;
    const street =
      typeof raw.logradouro === "string" && raw.logradouro.trim().length > 0 ? raw.logradouro.trim() : undefined;
    const neighborhood =
      typeof raw.bairro === "string" && raw.bairro.trim().length > 0 ? raw.bairro.trim() : undefined;
    const city =
      typeof raw.localidade === "string" && raw.localidade.trim().length > 0 ? raw.localidade.trim() : undefined;
    const state = typeof raw.uf === "string" && raw.uf.trim().length === 2 ? raw.uf.trim().toUpperCase() : undefined;
    let complement =
      typeof raw.complemento === "string" && raw.complemento.trim().length > 0 ? raw.complemento.trim() : undefined;
    if (!street && !neighborhood && !city && !state) return { zip: digits };

    return {
      zip: digits,
      street,
      complement,
      neighborhood,
      city,
      state
    };
  } catch {
    // An unavailable provider must not make a valid delivery CEP look invalid.
    // Only the public CEP is sent; the account and full address stay local.
    try {
      const raw = await read(`https://brasilapi.com.br/api/cep/v2/${digits}`) as {
        cep?: string; street?: string; neighborhood?: string; city?: string; state?: string;
      } | null;
      if (!raw || raw.cep?.replace(/\D/g, "") !== digits || !raw.city?.trim() || !/^[a-z]{2}$/i.test(raw.state ?? "")) return null;
      return { zip: digits, street: raw.street?.trim() || undefined, complement: undefined,
        neighborhood: raw.neighborhood?.trim() || undefined, city: raw.city.trim(), state: raw.state!.toUpperCase() };
    } catch {
      return null;
    }
  }
}

export function estimatePacQuote(address: Pick<CustomerAddress, "zip" | "state">): {
  customerPrice: number;
  carrier: string;
  method: string;
  deliveryDays: number;
  region: string;
  destinationZip: string;
  realCost: number;
} {
  const rg = address.state ?? "BR";
  const destinationZip = address.zip!.replace(/\D/g, "");
  const southeast = new Set(["SP", "RJ", "MG", "ES"]);
  const base = southeast.has(rg) ? 28.9 : 38.9;
  const deliveryDays = southeast.has(rg) ? 4 : 8;
  return {
    customerPrice: base,
    realCost: Math.round(base * 0.82 * 100) / 100,
    carrier: "Correios (estimativa)",
    method: "PAC — via CEP (estimativa; transportadora real será confirmada)",
    deliveryDays,
    region: rg,
    destinationZip
  };
}
