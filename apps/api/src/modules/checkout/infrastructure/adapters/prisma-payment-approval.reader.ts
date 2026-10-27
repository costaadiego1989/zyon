import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { PaymentApprovalReader, PersistedPaymentApproval } from "../../domain/ports/payment-approval.port.js";
import { readPaymentCouponAuthority } from "../../../payment/domain/payment-coupon-authority.js";
import { readPaymentWidgetCheckoutAuthority } from "../../../payment/domain/payment-widget-checkout-authority.js";
import { readPaymentNormalCrossSellAuthority } from "../../../payment/domain/payment-normal-cross-sell-authority.js";

export class PrismaPaymentApprovalReader implements PaymentApprovalReader {
  constructor(private readonly prisma: PrismaClient) {}

  async find(merchantId: string, sessionId: string, paymentIntentId: string): Promise<PersistedPaymentApproval | null> {
    if (!merchantId || !sessionId || !paymentIntentId) return null;
    const row = await this.prisma.paymentIntent.findFirst({
      where: { id: paymentIntentId, merchantId, sessionId },
      select: {
        id: true, merchantId: true, sessionId: true, status: true, currency: true,
        amountCents: true, approvedAmountCents: true, providerPaymentId: true,
        acceptedOfferId: true, amountBreakdown: true, method: true, creation: true,
      },
    });
    if (!row) return null;
    if (row.id !== paymentIntentId || row.merchantId !== merchantId || row.sessionId !== sessionId)
      throw new Error("payment_coupon_authority_conflict");
    const method = z.enum(["pix", "card", "boleto", "crypto"]).safeParse(row.method);
    if (!method.success) throw new Error("payment_coupon_authority_conflict");
    const couponAuthority = readPaymentCouponAuthority({ ...row, method: method.data });
    const widgetCheckoutAuthority = readPaymentWidgetCheckoutAuthority({ ...row, method: method.data });
    const normalCrossSellAuthority = readPaymentNormalCrossSellAuthority({ ...row, method: method.data });
    if (couponAuthority && widgetCheckoutAuthority) throw new Error("payment_widget_checkout_authority_conflict");
    // Select creation only for verification. Neither the raw journal nor provider
    // input may cross this internal port, let alone a public projection.
    return {
      id: row.id, merchantId: row.merchantId, sessionId: row.sessionId, status: row.status, currency: row.currency,
      amountCents: row.amountCents, approvedAmountCents: row.approvedAmountCents, providerPaymentId: row.providerPaymentId,
      acceptedOfferId: row.acceptedOfferId,
      amountBreakdown: structuredClone(row.amountBreakdown) as PersistedPaymentApproval["amountBreakdown"],
      ...(couponAuthority ? { couponAuthority } : {}),
      ...(widgetCheckoutAuthority ? { widgetCheckoutAuthority } : {}),
      ...(normalCrossSellAuthority ? { normalCrossSellAuthority } : {}),
    };
  }
}
