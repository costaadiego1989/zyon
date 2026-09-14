export function isPlatformHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) return true;
  return ["zyon.com", "zyon-payments.com.br", "vercel.app"].some(base => host === base || host.endsWith("." + base));
}
