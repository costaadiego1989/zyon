const DEFAULT_ASAAS_SANDBOX_ORIGIN = "https://api-sandbox.asaas.com";
const DEFAULT_ASAAS_PRODUCTION_ORIGIN = "https://api.asaas.com";

/** `ASAAS_SANDBOX=true` → URL sandbox + `ASAAS_API_KEY_SANDBOX`. Caso contrário → URL produção + `ASAAS_API_KEY`. Ver [Ambientes Asaas](https://docs.asaas.com/docs/authentication-2). */
export function parseAsaasSandboxEnv(): boolean {
  const v = process.env.ASAAS_SANDBOX?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Origin sem `/v3` — o adapter acrescenta `/v3/...`. */
export function readAsaasConnection(): { sandbox: boolean; apiKey: string | undefined; baseUrl: string } {
  const sandbox = parseAsaasSandboxEnv();

  if (sandbox) {
    const key = process.env.ASAAS_API_KEY_SANDBOX?.trim();
    const baseUrl =
      process.env.ASAAS_API_BASE_URL_SANDBOX?.trim() ||
      process.env.ASAAS_API_BASE_URL?.trim() ||
      DEFAULT_ASAAS_SANDBOX_ORIGIN;
    return { sandbox: true, apiKey: key || undefined, baseUrl };
  }

  const key = process.env.ASAAS_API_KEY?.trim();
  const baseUrl = process.env.ASAAS_API_BASE_URL?.trim() || DEFAULT_ASAAS_PRODUCTION_ORIGIN;
  return { sandbox: false, apiKey: key || undefined, baseUrl };
}

export function isAsaasConfigured(): boolean {
  return Boolean(readAsaasConnection().apiKey);
}
