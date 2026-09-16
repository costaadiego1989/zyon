export function isPlatformHostname(hostname: string, deploymentHostname?: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (deploymentHostname && host === deploymentHostname.toLowerCase().replace(/\.$/, "")) return true;
  if (["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) return true;
  return ["zyon.com", "zyon-payments.com.br", "vercel.app"].some(base => host === base || host.endsWith("." + base));
}

/** Standalone Next may construct nextUrl from its internal bind address. */
export function storefrontRequestHostname(hostHeader: string | null, fallback: string): string {
  if (hostHeader && !/[\s/\\@?#]/.test(hostHeader)) {
    try { return new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/\.$/, ""); } catch { /* invalid Host */ }
  }
  return fallback.toLowerCase().replace(/\.$/, "");
}

/** External request authority preserved by the hosting proxy in standalone mode. */
export function storefrontRequestOrigin(request: Request): string {
  const fallback = new URL(request.url);
  const host = request.headers.get("host");
  if (!host || /[\s/\\@?#]/.test(host)) return fallback.origin;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto + ":" : fallback.protocol;
  try { return new URL(protocol + "//" + host).origin; } catch { return fallback.origin; }
}
