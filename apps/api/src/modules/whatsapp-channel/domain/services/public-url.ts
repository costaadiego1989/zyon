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
