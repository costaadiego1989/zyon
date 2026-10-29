import type { StorefrontWriteStateRequest, StorefrontWriteStateResult } from "../contracts/storefront-write-state.schemas.js";

export const STOREFRONT_WRITE_STATE = Symbol("STOREFRONT_WRITE_STATE");

/** Trusted, already verified scope only. Observes the durable lane, never grants
 * permission, resolves uncertainty, returns cart contents or resumes execution.
 * Any observed request remains blocking, including one with a local effect. */
export interface StorefrontWriteStatePort {
  read(input: StorefrontWriteStateRequest): Promise<StorefrontWriteStateResult>;
}

