import type {
  StorefrontWriteAdmissionRequest, StorefrontWriteAdmissionResult,
  StorefrontWriteMarkUnknownRequest, StorefrontWriteMarkUnknownResult,
} from "../contracts/storefront-write-admission.schemas.js";

export type {
  StorefrontWriteAdmissionRequest, StorefrontWriteAdmissionResult, StorefrontWriteClaim,
  StorefrontWriteMarkUnknownRequest, StorefrontWriteMarkUnknownResult,
} from "../contracts/storefront-write-admission.schemas.js";

export const STOREFRONT_WRITE_ADMISSION = Symbol("STOREFRONT_WRITE_ADMISSION");

/** Internal durable admission only. Caller supplies an already verified scope.
 * No scope creation, commercial mutation, completion, recovery or lease takeover.
 * A claim is returned only after the adapter's transaction successfully commits. */
export interface StorefrontWriteAdmissionPort {
  admit(input: StorefrontWriteAdmissionRequest): Promise<StorefrontWriteAdmissionResult>;
  markUnknown(input: StorefrontWriteMarkUnknownRequest): Promise<StorefrontWriteMarkUnknownResult>;
}

