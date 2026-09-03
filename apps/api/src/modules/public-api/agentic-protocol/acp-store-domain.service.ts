import { Injectable } from "@nestjs/common";

/**
 * Base domain for buyer-facing confirmation URLs (e.g. order status page).
 * Override per environment via `AACP_STORE_DOMAIN`.
 *
 * Default: `zyon-payments.com.br` (current production domain). Will move when
 * you migrate branding; only this constant + env need to change.
 */
export const DEFAULT_STORE_DOMAIN = "zyon-payments.com.br";

export interface AcpMerchantProfileLike {
  slug?: string;
  id: string;
}

/**
 * Resolves the configured AACP store domain from env and builds the
 * merchant-scoped confirmation URL for a completed order.
 *
 * Read from `AACP_STORE_DOMAIN` at construction time; falls back to
 * {@link DEFAULT_STORE_DOMAIN}. Whitespace-only values are ignored.
 */
@Injectable()
export class AcpStoreDomainService {
  private readonly storeDomain: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const fromEnv = env.AACP_STORE_DOMAIN?.trim();
    this.storeDomain = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STORE_DOMAIN;
  }

  buildConfirmationUrl(
    profile: AcpMerchantProfileLike | undefined,
    orderId: string,
    storeDomain?: string,
  ): string {
    return buildConfirmationUrl(profile, orderId, storeDomain ?? this.storeDomain);
  }
}

export function buildConfirmationUrl(
  profile: AcpMerchantProfileLike | undefined,
  orderId: string,
  storeDomain = resolveStoreDomain(),
): string {
  const slug = profile?.slug?.trim();
  const subdomain = slug || profile?.id || "merchant";
  return `https://${subdomain}.${storeDomain}/orders/${encodeURIComponent(orderId)}`;
}

export function resolveStoreDomain(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.AACP_STORE_DOMAIN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STORE_DOMAIN;
}
