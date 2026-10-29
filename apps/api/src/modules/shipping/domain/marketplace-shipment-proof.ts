import { ConflictException } from "@nestjs/common";
import { marketplaceShippingContractHash as hash } from "./marketplace-shipping-contract.js";
import { assertMarketplaceShippingAccountIdentity } from "./marketplace-shipping-account-identity.js";
import { assertMarketplaceShipmentCancellationReceipt, assertMarketplaceShipmentGenerationReceipt,
  assertMarketplaceShipmentPurchaseReceipt, marketplaceShipmentCancellationDescription,
  marketplaceShipmentReference, marketplaceShipmentVolume, type MarketplaceShipmentRecord } from "./marketplace-shipment-journal.js";

/** Shared verification of persisted carrier history. No provider call or mutation. */
export function verifyMarketplaceShipmentRecord(value: unknown): MarketplaceShipmentRecord {
  const fail = (reason: string): never => { throw new ConflictException(`marketplace_shipment_${reason}`); };
  const r = value as MarketplaceShipmentRecord;
  const volume = marketplaceShipmentVolume(r.request);
  if (hash(r.request) !== r.requestHash || r.volumeIndex !== volume.index || r.request.paymentIntentId !== r.fundingPlanId ||
      r.request.originMerchantId !== r.originMerchantId || r.request.quoteId !== r.quoteId || r.request.quoteKey !== r.quoteKey ||
      r.request.environment !== r.environment || r.request.accountFingerprint !== r.accountFingerprint ||
      r.request.reference !== r.reference || r.reference !== marketplaceShipmentReference(r.hostMerchantId, r.fundingPlanId, r.originMerchantId, volume.index, volume.count)) fail("journal_invalid");
  if (r.request.accountIdentity !== undefined) {
    try { assertMarketplaceShippingAccountIdentity(r.request.accountIdentity, { environment: r.request.environment,
      originMerchantId: r.originMerchantId, accountFingerprint: r.accountFingerprint }); }
    catch { fail("journal_invalid"); }
  }
  if (r.purchaseReceipt) {
    assertMarketplaceShipmentPurchaseReceipt(r.purchaseReceipt, r.request, r.carrierOrderId!);
    if (r.purchaseReceiptHash !== hash(r.purchaseReceipt) || r.carrierPurchaseId !== r.purchaseReceipt.carrierPurchaseId) fail("purchase_receipt_invalid");
  } else if (r.purchaseReceiptHash || r.carrierPurchaseId || r.purchasedAt) fail("purchase_receipt_invalid");
  if (r.generationReceipt) {
    assertMarketplaceShipmentGenerationReceipt(r.generationReceipt, r.request, r.purchaseReceipt!, r.carrierOrderId!);
    if (hash(r.generationReceipt) !== r.generationReceiptHash || !r.generatedAt) fail("generation_receipt_invalid");
  } else if (r.generationReceiptHash || r.generatedAt) fail("generation_receipt_invalid");
  if (r.cancellationStatus) {
    if (!["unknown", "canceled"].includes(r.cancellationStatus) || !r.cancellationClaimedAt || !r.cancellationReason ||
        !["purchased", "generated"].includes(r.status) || !r.purchaseReceipt || !r.purchasedAt) fail("cancellation_journal_invalid");
    marketplaceShipmentCancellationDescription(r.cancellationReason!);
    if (r.cancellationStatus === "canceled") {
      assertMarketplaceShipmentCancellationReceipt(r.cancellationReceipt!, r.request, r.purchaseReceipt!, r.generationReceipt, r.carrierOrderId!);
      if (!r.canceledAt || r.cancellationReceiptHash !== hash(r.cancellationReceipt)) fail("cancellation_journal_invalid");
    } else if (r.cancellationReceipt || r.cancellationReceiptHash || r.canceledAt) fail("cancellation_journal_invalid");
  } else if (r.cancellationReason || r.cancellationClaimedAt || r.cancellationReceipt || r.cancellationReceiptHash || r.canceledAt) fail("cancellation_journal_invalid");
  return structuredClone(r);
}
