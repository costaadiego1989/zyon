import type { CustomerHints } from "@aacp/shared-types";

export const BUYER_IDENTITY_REPOSITORY = Symbol("BUYER_IDENTITY_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface BuyerIdentityRepository {
  resolveGlobalUserId(merchantId: string, customer?: CustomerHints): MaybePromise<string>;
}
