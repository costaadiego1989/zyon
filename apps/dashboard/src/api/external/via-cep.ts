/**
 * ViaCEP external API wrapper — centralized postal code lookup.
 * Wraps direct fetch() calls to viacep.com.br behind a service layer.
 * Acceptable to call external APIs from here (not internal AACP API).
 */

export interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

export async function lookupViaCep(cepDigits: string): Promise<ViaCepResponse | null> {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`);
    if (!res.ok) return null;
    const data = (await res.json()) as ViaCepResponse;
    if (data.erro) return null;
    return data;
  } catch {
    return null;
  }
}
