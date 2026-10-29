import type { CheckoutEmailOtpDeliveryPort } from "../../domain/ports/checkout-email-otp-delivery.port.js";
import type { EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";
import { buildEmailOtpMessage } from "../../../buyer-account/infrastructure/email-otp-template.js";
import { checkoutEmailOtpDeliveryScopeSchema, checkoutEmailOtpIssueRequestSchema, checkoutEmailOtpIssueAcknowledgementSchema,
  checkoutEmailOtpDeliveryRequestSchema, checkoutEmailOtpDeliveryClaimSchema, checkoutEmailOtpDeliveryAcknowledgementSchema,
  type CheckoutEmailOtpDeliveryAcknowledgement, type CheckoutEmailOtpDeliveryCompletion } from "../../domain/services/checkout-email-otp-delivery.schemas.js";

/** Unwired orchestration: no generation, persistence, recognition or retry here.
 * Authority methods commit before returning. Sender receives only that committed
 * server claim; errors cannot clear/reclaim sending or resend uncertain emails. */
export class CheckoutEmailOtpDeliveryService {
  constructor(private readonly authority: CheckoutEmailOtpDeliveryPort, private readonly email: EmailSenderPort,
    private readonly now: () => number = Date.now, private readonly sendTimeoutMilliseconds = 15_000) {
    if (!Number.isInteger(sendTimeoutMilliseconds) || sendTimeoutMilliseconds < 1 || sendTimeoutMilliseconds > 15_000)
      throw new Error("checkout_email_otp_timeout_invalid");
  }

  async request(rawScope: unknown, rawRequest: unknown): Promise<CheckoutEmailOtpDeliveryAcknowledgement> {
    const scope = checkoutEmailOtpDeliveryScopeSchema.parse(rawScope), request = checkoutEmailOtpIssueRequestSchema.parse(rawRequest);
    const ack = checkoutEmailOtpIssueAcknowledgementSchema.parse(await this.authority.requestEmailOtp(scope, request));
    if (ack.merchantId !== scope.merchantId || ack.sessionId !== scope.sessionId) throw new Error("checkout_email_otp_review_required");
    return this.deliver(scope, { expectedVersion: ack.persistenceVersion, deliveryId: ack.deliveryId });
  }

  async deliver(rawScope: unknown, rawRequest: unknown): Promise<CheckoutEmailOtpDeliveryAcknowledgement> {
    const scope = checkoutEmailOtpDeliveryScopeSchema.parse(rawScope), request = checkoutEmailOtpDeliveryRequestSchema.parse(rawRequest);
    const claim = checkoutEmailOtpDeliveryClaimSchema.parse(await this.authority.claimEmailOtpDelivery(scope, request));
    if (claim.merchantId !== scope.merchantId || claim.sessionId !== scope.sessionId || claim.deliveryId !== request.deliveryId
      || claim.persistenceVersion !== request.expectedVersion) throw new Error("checkout_email_otp_review_required");
    if (claim.kind === "settled") {
      const { kind: _kind, ...ack } = claim;
      return checkoutEmailOtpDeliveryAcknowledgementSchema.parse(ack);
    }
    const unknown = checkoutEmailOtpDeliveryAcknowledgementSchema.parse({ version: 1, ...scope,
      deliveryId: claim.deliveryId, persistenceVersion: claim.persistenceVersion, status: "unknown" });
    let outcome: CheckoutEmailOtpDeliveryCompletion["outcome"] = { status: "unknown" };
    // A delayed/expired claim must not dispatch stale identity credentials.
    const now = this.now(), remaining = Date.parse(claim.expiresAt) - now;
    if (Number.isFinite(now) && remaining > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const message = buildEmailOtpMessage(claim.code, { merchantName: claim.merchantName });
        const sent = await Promise.race([this.email.send({ to: claim.email, merchantId: scope.merchantId, subject: message.subject, html: message.html,
          requireDelivery: true, idempotencyKey: `checkout-email-otp:${scope.merchantId}:${claim.deliveryId}` }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("checkout_email_otp_acceptance_unknown")),
          Math.min(this.sendTimeoutMilliseconds, remaining)); })]);
        if (sent?.status === "sent" && typeof sent.messageId === "string" && sent.messageId.trim() && sent.messageId.trim().length <= 500)
          outcome = { status: "sent", providerMessageId: sent.messageId.trim() };
      } catch { /* Unknown acceptance, never automatic retry or a leaked error. */ }
      finally { if (timer) clearTimeout(timer); }
    }
    try {
      const completed = checkoutEmailOtpDeliveryAcknowledgementSchema.parse(await this.authority.completeEmailOtpDelivery(scope, {
        deliveryId: claim.deliveryId, claimToken: claim.claimToken, outcome,
      }));
      if (completed.merchantId !== scope.merchantId || completed.sessionId !== scope.sessionId || completed.deliveryId !== claim.deliveryId
        || completed.persistenceVersion !== claim.persistenceVersion || completed.status !== outcome.status) return unknown;
      return completed;
    } catch { return unknown; }
  }
}
