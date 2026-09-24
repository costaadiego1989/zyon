/** The provider explicitly refused creation; no payment was accepted. */
export class PaymentCreationRejectedError extends Error {
  constructor(readonly code: "mercadopago_oauth_required_for_platform_fee") {
    super(code);
    this.name = "PaymentCreationRejectedError";
  }
}
