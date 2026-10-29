/**
 * TenantBoundaryGuard: Compile-time + runtime assertion that merchant_id is consistent across aggregates.
 *
 * INVARIANT (CLAUDE.md):
 * "merchant_id is the tenant boundary."
 * Every query and command must be scoped by merchant_id.
 * Cross-tenant data access must be rejected early.
 *
 * USAGE:
 * ```typescript
 * const offer = await this.offers.getOffer(merchantId, offerId);
 * TenantBoundaryGuard.assert.merchantIdMatches(offer.merchantId, expectedMerchantId);
 * // or
 * if (!TenantBoundaryGuard.matches(offer.merchantId, expectedMerchantId)) {
 *   throw new ForbiddenException("cross_tenant_access_denied");
 * }
 * ```
 *
 * This guard prevents:
 * 1. Cross-session offer reuse across different merchants
 * 2. Agent context leakage from one merchant to another
 * 3. Shipping quote cache collision across merchants
 * 4. Purchase history mixing across merchants
 */
export class TenantBoundaryGuard {
  /**
   * Check if two merchantIds match (safe comparison).
   * Returns false if either is undefined or if they don't match.
   */
  static matches(actual: string | undefined, expected: string | undefined): boolean {
    if (!actual || !expected) return false;
    return actual === expected;
  }

  /**
   * Assert merchantIds match; throw ForbiddenException if not.
   * Use in request handlers and cross-aggregate lookups.
   */
  static assert = {
    merchantIdMatches(actual: string | undefined, expected: string | undefined, context?: string): void {
      if (!TenantBoundaryGuard.matches(actual, expected)) {
        const msg = context
          ? `Tenant boundary violation: ${context}. Expected merchant_id=${expected}, got ${actual}`
          : `Tenant boundary violation. Expected merchant_id=${expected}, got ${actual}`;
        throw new Error(msg);
      }
    },

    /**
     * Assert that a session belongs to the expected merchant.
     */
    sessionBelongsToMerchant(sessionMerchantId: string | undefined, expectedMerchantId: string, sessionId: string): void {
      if (!TenantBoundaryGuard.matches(sessionMerchantId, expectedMerchantId)) {
        throw new Error(
          `Tenant boundary violation: session ${sessionId} belongs to merchant ${sessionMerchantId}, not ${expectedMerchantId}`
        );
      }
    },

    /**
     * Assert that an offer was authorized for the expected merchant.
     */
    offerBelongsToMerchant(offerMerchantId: string | undefined, expectedMerchantId: string, offerId: string): void {
      if (!TenantBoundaryGuard.matches(offerMerchantId, expectedMerchantId)) {
        throw new Error(
          `Tenant boundary violation: offer ${offerId} belongs to merchant ${offerMerchantId}, not ${expectedMerchantId}`
        );
      }
    },

    /**
     * Assert that an offer was authorized for the expected session within the expected merchant.
     */
    offerBelongsToSession(
      offerMerchantId: string | undefined,
      offerSessionId: string | undefined,
      expectedMerchantId: string,
      expectedSessionId: string,
      offerId: string
    ): void {
      if (!TenantBoundaryGuard.matches(offerMerchantId, expectedMerchantId)) {
        throw new Error(
          `Tenant boundary violation: offer ${offerId} belongs to merchant ${offerMerchantId}, not ${expectedMerchantId}`
        );
      }
      if (offerSessionId !== expectedSessionId) {
        throw new Error(
          `Offer ${offerId} belongs to session ${offerSessionId}, not ${expectedSessionId} (cross-session reuse)`
        );
      }
    }
  };
}
