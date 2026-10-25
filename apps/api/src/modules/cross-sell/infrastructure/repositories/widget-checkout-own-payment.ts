import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { readPaymentWidgetCheckoutAuthority } from "../../../payment/domain/payment-widget-checkout-authority.js";
import type { widgetCrossSellCheckoutReceiptSchema, WidgetCrossSellCheckoutScope } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { widgetCheckoutRevisionContextHash } from "./widget-cross-sell-checkout-revision.js";
import { requireWidgetCrossSellReview } from "./prisma-widget-cross-sell-checkout.authority.js";

const ref = z.string().min(1).max(200);
const rowSchema = z.object({ id: ref, merchantId: ref, sessionId: ref,
  version: z.number().int().positive(), status: z.literal("pending"), providerPaymentId: z.null(),
  approvedAmountCents: z.null(), acceptedOfferId: z.null(), commerceOrderId: z.null(),
  amountCents: z.number().int().positive(), currency: z.literal("BRL"), method: z.string(),
  amountBreakdown: z.unknown(), creation: z.record(z.string(), z.unknown()),
});
const conflict = (): never => requireWidgetCrossSellReview();
type Stored = Parameters<typeof widgetCheckoutRevisionContextHash>[0] & { version: number };

/** Lookup hint, NOT a caller grant. This actual committed row is the ONLY
 * journal that may be excluded from the active-payment fence before first send.
 * Merchant/session locks must already be held. No exception for uncertain IO. */
export async function readWidgetCheckoutOwnPayment(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope,
  stored: Stored, receipt: z.infer<typeof widgetCrossSellCheckoutReceiptSchema> | undefined, ownPaymentIntentId: string) {
  try {
    const ownId = ref.parse(ownPaymentIntentId);
    if (!receipt) return conflict();
    await tx.$queryRaw`SELECT id FROM payment_intents WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId}
      AND id=${ownId} FOR UPDATE`;
    const row = rowSchema.parse(await tx.paymentIntent.findFirst({ where: { id: ownId, ...scope } }));
    const authority = readPaymentWidgetCheckoutAuthority(row), creation = row.creation;
    if (row.id !== ownId || row.merchantId !== scope.merchantId || row.sessionId !== scope.sessionId
      || creation.state !== "ready" || ["firstAttemptAt", "leaseToken", "leaseUntil", "cancellation", "couponAuthority"].some(key => key in creation)
      || !authority || authority.buyerId !== stored.globalUserId || authority.checkoutVersion !== stored.version
      || authority.acceptanceEventId !== receipt.eventId || authority.revisionEventId !== receipt.revision?.eventId
      || authority.contextHash !== widgetCheckoutRevisionContextHash(stored)) return conflict();
    return authority;
  } catch { return conflict(); }
}
