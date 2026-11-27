import { createHash, timingSafeEqual } from "node:crypto";
import type { FiscalProvider } from "../domain/fiscal-provider.js";
import { verifyBlingWebhookSignature } from "../../../shared/integrations/bling-webhook-auth.js";
export interface FiscalWebhookAuthenticationConfiguration { secret: string; headerName?: string }
function header(headers: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === name.toLowerCase());
  return matches.length === 1 && typeof matches[0]![1] === "string" ? matches[0]![1] as string : undefined;
}
export function authenticateFiscalWebhook(input: { provider: FiscalProvider; rawBody?: Uint8Array; headers: Readonly<Record<string, unknown>>; configuration?: FiscalWebhookAuthenticationConfiguration }):
  { authenticated: true } | { authenticated: false; reasonCode: string } {
  if (input.provider === "omie" || input.provider === "tiny") return { authenticated: false, reasonCode: "fiscal_webhook_query_only" };
  const config = input.configuration;
  if (!config?.secret || config.secret.length > 4096 || /[\r\n]/.test(config.secret)) return { authenticated: false, reasonCode: "fiscal_webhook_not_configured" };
  let authenticated = false;
  if (input.provider === "bling") authenticated = verifyBlingWebhookSignature(input.rawBody, header(input.headers, "x-bling-signature-256"), config.secret);
  else if (input.provider === "focus") {
    if (!config.headerName || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(config.headerName) || ["host", "content-length", "content-type", "connection", "transfer-encoding"].includes(config.headerName.toLowerCase())) return { authenticated: false, reasonCode: "fiscal_webhook_not_configured" };
    const supplied = header(input.headers, config.headerName);
    if (supplied && supplied.length <= 4096) authenticated = timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(config.secret).digest());
  }
  return authenticated ? { authenticated: true } : { authenticated: false, reasonCode: "fiscal_webhook_authentication_failed" };
}
