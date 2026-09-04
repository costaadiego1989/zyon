/**
 * DEPRECATED: This file previously held 77 methods spanning 8 domains.
 * All methods have been split into focused domain files:
 *   - webhook.ts (6 methods)
 *   - order.ts (4 methods)
 *   - customer.ts + paymentEndpoints (7 methods)
 *   - billing.ts (11 methods)
 *   - onboarding.ts (3 methods)
 *   - agent.ts (3 methods)
 *   - negotiation.ts (5 methods)
 *   - audit.ts (1 method)
 *   - integration.ts (7 + commerce 5 + installations 3 methods)
 *
 * This empty shell is kept for backward compatibility with any
 * import of `otherEndpoints`. It contributes zero methods.
 */

export function otherEndpoints(_base: string, _f: typeof fetch) {
  return {};
}
