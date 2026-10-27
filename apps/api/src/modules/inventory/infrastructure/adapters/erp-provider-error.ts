/** Provider responses are translated to safe codes; secrets and raw bodies never enter logs or DTOs. */
export class ErpProviderError extends Error {
  constructor(code: string, readonly requiresReconnect = false, readonly retryAfterMs?: number) {
    super(code);
    this.name = "ErpProviderError";
  }
}

export const ERP_AUTH_ERROR_CODES = [
  "erp_bling_reauthorization_required", "erp_bling_app_changed", "erp_bling_app_configuration_invalid",
  "erp_omie_credentials_invalid_or_app_suspended", "erp_omie_access_denied",
] as const;

export function isErpAuthError(code: string | null | undefined): boolean {
  return ERP_AUTH_ERROR_CODES.includes(code as typeof ERP_AUTH_ERROR_CODES[number]);
}

export function erpCooldownUntil(config: unknown): Date | null {
  const value = config && typeof config === "object" ? (config as Record<string, unknown>).erpRetryAfterAt : undefined;
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > Date.now() ? new Date(ms) : null;
}

export async function readOmieResponse(response: Response): Promise<any> {
  let body: any;
  try { body = await response.json(); } catch { body = null; }
  const text = String(body?.faultstring ?? body?.message ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (response.status === 425) throw new ErpProviderError("erp_omie_temporarily_blocked", false, 30 * 60_000);
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    throw new ErpProviderError("erp_omie_rate_limited", false, Math.max(60_000, Number.isFinite(retry) ? retry * 1000 : 0));
  }
  if (/limite.*(diari|por dia)|cota.*(diari|por dia)|daily.*limit/.test(text)) throw new ErpProviderError("erp_omie_daily_limit", false, 24 * 60 * 60_000);
  if (/chave.*inval|aplicativo.*suspens|credenc.*inval|invalid.*(credential|app.?key|app.?secret)/.test(text) || response.status === 401) {
    throw new ErpProviderError("erp_omie_credentials_invalid_or_app_suspended", true);
  }
  if (response.status === 403) throw new ErpProviderError("erp_omie_access_denied", true);
  if (!response.ok) throw new ErpProviderError(`erp_omie_http_${response.status}`);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ErpProviderError("erp_omie_invalid_response");
  if (body.faultcode || body.faultstring || (body.status && body.status !== "OK") || (body.codigo_status !== undefined && String(body.codigo_status) !== "0")) throw new ErpProviderError("erp_omie_api_error");
  return body;
}
