import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import { resolveStoreDomain, DEFAULT_STORE_DOMAIN } from "../agentic-protocol/acp-store-domain.service.js";

export interface MerchantResolverConfig {
  baseDomains: string[];
  platformHosts: string[];
}

export type ResolvedMerchant =
  | { kind: "platform"; merchantId: "platform-default" }
  | {
      kind: "merchant";
      merchantId: string;
      slug: string;
      merchantName: string;
      merchantUrl: string;
    };

export function readResolverConfig(
  env: NodeJS.ProcessEnv = process.env,
  storeDomain: string = resolveStoreDomain(env),
): MerchantResolverConfig {
  const baseSet = new Set<string>();
  baseSet.add(storeDomain || DEFAULT_STORE_DOMAIN);
  const extra = env.AACP_API_BASE_DOMAINS?.split(",") ?? [];
  for (const d of extra) {
    const trimmed = d.trim().toLowerCase();
    if (trimmed) baseSet.add(trimmed);
  }

  const platformSet = new Set<string>();
  const apiHosts = env.AACP_PLATFORM_HOSTS?.split(",") ?? [];
  for (const h of apiHosts) {
    const trimmed = h.trim().toLowerCase();
    if (trimmed) platformSet.add(trimmed);
  }
  platformSet.add(`api.${storeDomain}`);

  return {
    baseDomains: Array.from(baseSet),
    platformHosts: Array.from(platformSet),
  };
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;
const RESERVED_SUBDOMAINS = new Set([
  "api", "www", "cdn", "static", "assets", "mail", "smtp", "imap",
  "admin", "dashboard", "app", "auth", "login", "docs",
]);

export function extractSlugFromHost(
  host: string | null | undefined,
  baseDomains: string[],
): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0]?.toLowerCase().trim();
  if (!hostname) return null;
  if (IPV4_RE.test(hostname) || hostname === "localhost") return null;
  if (hostname.includes(":")) return null;

  for (const base of baseDomains) {
    const normalizedBase = base.trim().toLowerCase().replace(/^\.+/, "");
    if (!normalizedBase) continue;
    if (hostname === normalizedBase) return null;
    if (hostname.endsWith(`.${normalizedBase}`)) {
      const slug = hostname.slice(0, hostname.length - normalizedBase.length - 1);
      if (!slug || slug.includes(".")) return null;
      if (RESERVED_SUBDOMAINS.has(slug)) return null;
      return slug;
    }
  }
  return null;
}

export async function resolveMerchantFromHost(
  host: string | null | undefined,
  repo: Pick<MerchantRepository, "findBySlug" | "findByCustomDomain">,
  config: MerchantResolverConfig,
  storeDomain: string = config.baseDomains[0] ?? DEFAULT_STORE_DOMAIN,
): Promise<ResolvedMerchant> {
  if (!host) return { kind: "platform", merchantId: "platform-default" };
  const hostname = host.split(":")[0]?.toLowerCase().trim();
  if (!hostname) return { kind: "platform", merchantId: "platform-default" };

  if (config.platformHosts.includes(hostname)) {
    return { kind: "platform", merchantId: "platform-default" };
  }

  const slug = extractSlugFromHost(hostname, config.baseDomains);
  if (slug) {
    try {
      const profile = await repo.findBySlug?.(slug);
      if (profile) {
        return {
          kind: "merchant",
          merchantId: profile.id,
          slug,
          merchantName: profile.name,
          merchantUrl: `https://${slug}.${storeDomain}`,
        };
      }
    } catch {
      // swallow — fall through to custom-domain lookup, then default
    }
  }

  if (!IPV4_RE.test(hostname) && !IPV6_RE.test(hostname) && hostname !== "localhost") {
    try {
      const byDomain = await repo.findByCustomDomain?.(hostname);
      if (byDomain) {
        const effectiveSlug = byDomain.storeSettings?.slug?.trim() || byDomain.id;
        return {
          kind: "merchant",
          merchantId: byDomain.id,
          slug: effectiveSlug,
          merchantName: byDomain.name,
          merchantUrl: `https://${hostname}`,
        };
      }
    } catch {
      // swallow
    }
  }

  return { kind: "platform", merchantId: "platform-default" };
}
