import type { CustomerAddress } from "@aacp/shared-types";

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

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 4500);
  try {
    const url = `https://viacep.com.br/ws/${digits}/json/`;
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      erro?: boolean | string;
      logradouro?: string;
      complemento?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };
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
    return null;
  } finally {
    globalThis.clearTimeout(timer);
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
