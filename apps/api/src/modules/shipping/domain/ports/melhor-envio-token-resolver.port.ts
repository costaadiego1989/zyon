export const MELHOR_ENVIO_TOKEN_RESOLVER = Symbol("MELHOR_ENVIO_TOKEN_RESOLVER");

/**
 * Resolves the Melhor Envio OAuth access token for a given merchant.
 *
 * Multi-tenancy: each merchant connects its own Melhor Envio account via OAuth
 * (token persisted encrypted on the merchant record). The carrier adapter must
 * use the per-merchant token — never a single global env token shared across
 * tenants. Implementations decrypt the stored token and fall back to
 * MELHOR_ENVIO_TOKEN only when a merchant has not connected its own account
 * (e.g. local/dev single-tenant testing).
 */
export interface MelhorEnvioTokenResolver {
  /**
   * Returns the usable access token for the merchant, or undefined when the
   * merchant has no connected account and no env fallback is configured.
   * Returns undefined for an expired token so the caller degrades gracefully
   * (flat-rate only) instead of calling the API with a dead credential.
   */
  resolveToken(merchantId: string): Promise<string | undefined>;
}
