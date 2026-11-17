/**
 * Resolve the platform's public base URL for outbound webhook callbacks
 * (e.g. the Twilio WhatsApp sender status/inbound callback).
 *
 * Reads API_PUBLIC_URL. Returns null when unset or obviously invalid so callers
 * can skip registering a bad callback instead of pointing Twilio at a
 * placeholder domain (the old hardcoded "https://api.aacp.com" bug).
 */
export function resolvePublicApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.API_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Reject the known-bad placeholder that shipped as the old fallback.
    if (url.hostname === "api.aacp.com") return null;
    // Strip any trailing slash for clean path joins.
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Build the Twilio WhatsApp webhook callback URL, or null when no valid public
 * URL is configured (caller should then omit the webhook from the sender
 * registration rather than send an unreachable one).
 */
export function twilioWhatsAppCallbackUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = resolvePublicApiBaseUrl(env);
  return base ? `${base}/v1/webhooks/whatsapp/twilio` : null;
}

const OPERATOR_STATUS_PATH = "/v1/webhooks/whatsapp/twilio/status";
const callbackSelector = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
function operatorStatusBase(env: NodeJS.ProcessEnv): string | null {
  const base = resolvePublicApiBaseUrl(env); if (!base) return null;
  const url = new URL(base);
  return url.username || url.password || url.search || url.hash ? null : base;
}
/** Public selectors only. Private attempt, lease and credential facts stay in
 * storage and cannot be granted by a copied callback URL. */
export function twilioOperatorStatusCallbackUrl(configId: string, correlationId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = operatorStatusBase(env);
  if (!base || !callbackSelector(configId) || !callbackSelector(correlationId)
    || !correlationId.startsWith("support_message:") || correlationId.length <= "support_message:".length) return null;
  return `${base}${OPERATOR_STATUS_PATH}?configId=${encodeURIComponent(configId)}&correlationId=${encodeURIComponent(correlationId)}`;
}
/** Preserve the original encoded query exactly for signature validation. The
 * configured public prefix supplies the external URL; Host is not authority. */
export function twilioOperatorStatusRequestUrl(originalUrl: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = operatorStatusBase(env);
  if (!base || typeof originalUrl !== "string" || originalUrl.length > 8192 || originalUrl.includes("#")) return null;
  const query = originalUrl.indexOf("?");
  if ((query < 0 ? originalUrl : originalUrl.slice(0, query)) !== OPERATOR_STATUS_PATH) return null;
  return base + originalUrl;
}
