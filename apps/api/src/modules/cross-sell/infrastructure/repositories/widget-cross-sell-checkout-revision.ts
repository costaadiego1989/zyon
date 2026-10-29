import { createHash } from "node:crypto";
import type { z } from "zod";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import type { widgetCrossSellCheckoutReceiptSchema } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";

/** Canonical technical hash shared by manual and provider quote readers. */
export const widgetCheckoutShippingHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

/** Technical context commitment only, not an authorization or public token.
 * Canonical JSON is required: PostgreSQL jsonb does not preserve key order. */
export function widgetCheckoutRevisionContextHash(row: { merchantId: string; sessionId: string; globalUserId: string;
  customer?: unknown; shipping?: unknown; shippingOptions?: unknown; paymentMethod?: unknown; strategyContextVersion: number }) {
  return createHash("sha256").update(canonicalJson({ merchantId: row.merchantId, sessionId: row.sessionId, globalUserId: row.globalUserId,
    customer: row.customer ?? null, shipping: row.shipping ?? null, shippingOptions: row.shippingOptions ?? null,
    paymentMethod: row.paymentMethod ?? null, strategyContextVersion: row.strategyContextVersion })).digest("hex");
}

export function widgetCheckoutRevisionMetadata(receipt: z.infer<typeof widgetCrossSellCheckoutReceiptSchema>) {
  if (!receipt.revision) throw new Error("cross_sell_quote_review_required");
  const provider = ["provider_shipping_begin", "provider_shipping_complete", "provider_shipping_unknown"].includes(receipt.revision.operation ?? "");
  if (provider !== (receipt.revision.providerRequestId !== undefined) || provider !== (receipt.revision.providerSnapshotHash !== undefined)) throw new Error("cross_sell_quote_review_required");
  return { acceptance_event_id: receipt.eventId, previous_revision_event_id: receipt.revision.previousEventId,
    previous_version: receipt.revision.persistenceVersion - 1, checkout_version: receipt.revision.persistenceVersion,
    context_hash: receipt.revision.contextHash,
    ...(provider ? { provider_request_id: receipt.revision.providerRequestId, provider_snapshot_hash: receipt.revision.providerSnapshotHash } : {}),
    ...(receipt.revision.operation ? { operation: receipt.revision.operation } : {}) };
}

export function widgetCheckoutRevisionEventName(receipt: z.infer<typeof widgetCrossSellCheckoutReceiptSchema>) {
  if (receipt.revision?.operation === "provider_shipping_begin") return "cross_sell_checkout_provider_shipping_begun";
  if (receipt.revision?.operation === "provider_shipping_complete") return "cross_sell_checkout_provider_shipping_completed";
  if (receipt.revision?.operation === "provider_shipping_unknown") return "cross_sell_checkout_provider_shipping_unknown";
  if (receipt.revision?.operation === "email_otp_issue") return "cross_sell_checkout_email_otp_issued";
  if (receipt.revision?.operation === "manual_shipping_select") return "cross_sell_checkout_manual_shipping_selected";
  if (receipt.revision?.operation === "manual_shipping_quote") return "cross_sell_checkout_manual_shipping_quoted";
  if (receipt.revision?.operation === "email_otp") return "cross_sell_checkout_email_verified";
  return receipt.revision?.operation === "address" ? "cross_sell_checkout_address_updated" : "cross_sell_checkout_customer_updated";
}
