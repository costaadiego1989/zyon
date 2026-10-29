import type { StorefrontClaimedCartEffectRequest, StorefrontClaimedCartEffectResult } from "../contracts/storefront-claimed-cart-effect.schemas.js";

export type { StorefrontClaimedCartEffectRequest, StorefrontClaimedCartEffectResult } from "../contracts/storefront-claimed-cart-effect.schemas.js";

/** Internal effect boundary. Future infrastructure wiring must bind the exact
 * claim-fenced executor and trusted transaction-bound commercial readers. */
export interface StorefrontLocalCartEffectPort {
  execute(input: StorefrontClaimedCartEffectRequest): Promise<StorefrontClaimedCartEffectResult>;
}

