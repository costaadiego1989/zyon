import type { CheckoutEmailOtpDeliveryScope, CheckoutEmailOtpIssueRequest, CheckoutEmailOtpIssueAcknowledgement,
  CheckoutEmailOtpDeliveryRequest, CheckoutEmailOtpDeliveryClaim, CheckoutEmailOtpDeliveryCompletion,
  CheckoutEmailOtpDeliveryAcknowledgement } from "../services/checkout-email-otp-delivery.schemas.js";

/** Implemented only by the accepted-checkout authority, never by a generic
 * save-session wrapper. Each method owns its transaction and existing fences.
 * A claim may return secrets ONLY after its durable sending marker commits. */
export interface CheckoutEmailOtpDeliveryPort {
  requestEmailOtp(scope: CheckoutEmailOtpDeliveryScope, request: CheckoutEmailOtpIssueRequest): Promise<CheckoutEmailOtpIssueAcknowledgement>;
  claimEmailOtpDelivery(scope: CheckoutEmailOtpDeliveryScope, request: CheckoutEmailOtpDeliveryRequest): Promise<CheckoutEmailOtpDeliveryClaim>;
  completeEmailOtpDelivery(scope: CheckoutEmailOtpDeliveryScope, request: CheckoutEmailOtpDeliveryCompletion): Promise<CheckoutEmailOtpDeliveryAcknowledgement>;
}
