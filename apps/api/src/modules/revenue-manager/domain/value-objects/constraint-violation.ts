export type ConstraintViolationCode =
  | "MERCHANT_ALREADY_HAS_RUNNING_EXPERIMENT"
  | "HYPOTHESIS_INVALID_JSON"
  | "HYPOTHESIS_EXTREME_DISCOUNT"
  | "OBSERVATION_NOT_FOUND"
  | "MERCHANT_ID_MISSING";

export class ConstraintViolation extends Error {
  constructor(
    readonly code: ConstraintViolationCode,
    readonly merchantId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`[${code}] ${merchantId ? `(merchant=${merchantId}) ` : ""}${JSON.stringify(details || {})}`);
    this.name = "ConstraintViolation";
  }
}
