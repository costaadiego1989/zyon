export const STOREFRONT_TOOL_OUTCOME_UNKNOWN = "store_tool_outcome_unknown";

/** A mutation/reservation may have committed. Do not retry or claim rejection. */
export class StorefrontToolOutcomeUnknownError extends Error {
  readonly code = STOREFRONT_TOOL_OUTCOME_UNKNOWN;
  constructor() { super(STOREFRONT_TOOL_OUTCOME_UNKNOWN); }
}

