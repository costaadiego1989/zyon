/**
 * CSS-M1: Domain exception for checkout settings validation errors.
 * Carries a machine-readable `code` field for programmatic handling.
 */
export class CheckoutSettingsValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CheckoutSettingsValidationError";
    this.code = code;
  }
}
