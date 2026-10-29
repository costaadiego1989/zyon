const rejectionCodes = ["mercadopago_oauth_required_for_platform_fee", "mercadopago_pix_key_required"] as const;
type RejectionCode = typeof rejectionCodes[number];

export function isPaymentCreationRejectionCode(value: unknown): value is RejectionCode {
  return rejectionCodes.some(code => code === value);
}

/** The provider explicitly refused creation; no payment was accepted. */
export class PaymentCreationRejectedError extends Error {
  constructor(readonly code: RejectionCode, readonly providerCode?: string) {
    super(code);
    this.name = "PaymentCreationRejectedError";
  }
}
