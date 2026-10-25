/**
 * MerchantIdGenerator port — domain-level ID generation.
 * Closes M11, H6.
 */

export const MERCHANT_ID_GENERATOR = Symbol("MERCHANT_ID_GENERATOR");

export interface MerchantIdGenerator {
  generate(): string;
}

/**
 * Default implementation using crypto.randomUUID with the mrc_ prefix.
 */
export class DefaultMerchantIdGenerator implements MerchantIdGenerator {
  generate(): string {
    return `mrc_${crypto.randomUUID()}`;
  }
}
