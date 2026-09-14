const BLING_COMPANY_ENDPOINT = "https://api.bling.com.br/Api/v3/empresas/me/dados-basicos";

/**
 * Webhook payloads identify the account by the canonical company ID returned
 * by Bling's company endpoint. JWT claims are not a stable routing contract.
 */
export async function fetchBlingCompanyId(accessToken: string): Promise<string> {
  const response = await fetch(BLING_COMPANY_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "enable-jwt": "1",
    },
  });
  if (!response.ok) throw new Error(`erp_bling_company_http_${response.status}`);

  const body = await response.json() as { data?: { id?: unknown } };
  const companyId = String(body.data?.id ?? "").trim();
  if (!companyId) throw new Error("bling_company_identity_missing");
  return companyId;
}
