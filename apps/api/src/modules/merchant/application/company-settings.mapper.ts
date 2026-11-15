import type { MerchantStoreSettings } from "../domain/merchant.types.js";

/** Public business data only. Authentication records are deliberately absent. */
export function mapCompanySettings(value: unknown, merchantName?: string): NonNullable<MerchantStoreSettings["company"]> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const company: NonNullable<MerchantStoreSettings["company"]> = {};
  for (const key of ["description", "cnpj", "razaoSocial", "inscricaoEstadual", "email", "phone"] as const) {
    const field = source[key];
    if (typeof field === "string") company[key] = field;
  }
  if (!company.razaoSocial && merchantName) company.razaoSocial = merchantName;
  if (source.address && typeof source.address === "object" && !Array.isArray(source.address)) {
    const address = source.address as Record<string, unknown>;
    company.address = {};
    for (const key of ["street", "number", "complement", "neighborhood", "city", "state", "zip"] as const) {
      if (typeof address[key] === "string") company.address[key] = address[key];
    }
  }
  return company;
}
