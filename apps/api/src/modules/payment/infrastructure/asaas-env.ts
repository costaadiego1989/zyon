// Asaas canonical sandbox/production origins (origin only — the adapter appends /v3).
// The legacy `api-sandbox.asaas.com` (without `.br`) is the historical hostname;
// the current canonical hostname is `api-sandbox.asaas.com.br` per
// https://docs.asaas.com/reference/ambiente-de-teste
const DEFAULT_ASAAS_SANDBOX_ORIGIN = "https://sandbox.asaas.com/api";
const DEFAULT_ASAAS_PRODUCTION_ORIGIN = "https://www.asaas.com/api";

/** Strips trailing slash + any trailing `/v3` or `/api/v3` so the adapter can
 * safely append `/v3/...`. A config value like `https://www.asaas.com/api/v3`
 * otherwise becomes `https://www.asaas.com/api/v3/v3/payments` (404) and — worse
 * — silently routes sandbox traffic to the production domain. */
function normalizeBaseOrigin(raw: string): string {
  let v = raw.trim();
  // strip query / fragment just in case
  v = v.split("?")[0]!.split("#")[0]!;
  // strip trailing slashes
  v = v.replace(/\/+$/, "");
  // strip any `/v3` or `/api/v3` suffix — the adapter always appends `/v3`
  v = v.replace(/\/(?:api\/)?v3$/i, "");
  return v;
}

/** Detects `www.asaas.com` / `api.asaas.com` — these are PRODUCTION origins.
 * Used to refuse sandbox env values that accidentally point at production. */
function isProductionOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "asaas.com" ||
      host === "asaas.com.br" ||
      host === "www.asaas.com" ||
      host === "www.asaas.com.br" ||
      host === "api.asaas.com" ||
      host === "api.asaas.com.br";
  } catch {
    return false;
  }
}

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
    const rawOverride =
      process.env.ASAAS_API_BASE_URL_SANDBOX?.trim() ||
      process.env.ASAAS_BASE_URL_SANDBOX?.trim() ||
      process.env.ASAAS_API_BASE_URL?.trim() ||
      process.env.ASAAS_BASE_URL?.trim();
    // Refuse to honor a sandbox override that points at the production origin —
    // this is almost always a misconfig (e.g. `www.asaas.com` copy-pasted).
    // Fall back to the canonical sandbox origin instead.
    const baseUrl = rawOverride && !isProductionOrigin(normalizeBaseOrigin(rawOverride))
      ? normalizeBaseOrigin(rawOverride)
      : DEFAULT_ASAAS_SANDBOX_ORIGIN;
    return { sandbox: true, apiKey: key || undefined, baseUrl };
  }

  const key = process.env.ASAAS_API_KEY?.trim();
  const rawOverride =
    process.env.ASAAS_API_BASE_URL?.trim() ||
    process.env.ASAAS_BASE_URL?.trim();
  const baseUrl = rawOverride
    ? normalizeBaseOrigin(rawOverride)
    : DEFAULT_ASAAS_PRODUCTION_ORIGIN;
  return { sandbox: false, apiKey: key || undefined, baseUrl };
}

export function isAsaasConfigured(): boolean {
  return Boolean(readAsaasConnection().apiKey);
}
