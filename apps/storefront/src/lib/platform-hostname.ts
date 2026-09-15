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
