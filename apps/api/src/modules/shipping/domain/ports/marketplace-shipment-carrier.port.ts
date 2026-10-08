import type { MarketplaceShipmentEvidence, MarketplaceShipmentRequest, MarketplaceShipmentPurchaseReceipt, MarketplaceShipmentStageEvidence,
  MarketplaceShipmentGenerationReceipt, MarketplaceShipmentPrintResult, MarketplaceShipmentCancellationReason,
  MarketplaceShipmentCancellationEvidence, MarketplaceShipmentTrackingEvidence } from "../marketplace-shipment-journal.js";

export const MARKETPLACE_SHIPMENT_CARRIER = Symbol("MARKETPLACE_SHIPMENT_CARRIER");
export interface MarketplaceShipmentCarrier {
  createCart(request: MarketplaceShipmentRequest): Promise<MarketplaceShipmentEvidence & { status: "unknown"; notSubmitted?: boolean }>;
  reconcileCart(request: MarketplaceShipmentRequest, carrierOrderId: string): Promise<MarketplaceShipmentEvidence>;
  purchase(request: MarketplaceShipmentRequest, carrierOrderId: string): Promise<MarketplaceShipmentStageEvidence & { notSubmitted?: boolean }>;
  reconcilePurchase(request: MarketplaceShipmentRequest, carrierOrderId: string, receipt: MarketplaceShipmentPurchaseReceipt | null): Promise<MarketplaceShipmentStageEvidence>;
  generate(request: MarketplaceShipmentRequest, carrierOrderId: string, receipt: MarketplaceShipmentPurchaseReceipt): Promise<MarketplaceShipmentStageEvidence & { notSubmitted?: boolean }>;
  reconcileGeneration(request: MarketplaceShipmentRequest, carrierOrderId: string, receipt: MarketplaceShipmentPurchaseReceipt): Promise<MarketplaceShipmentStageEvidence>;
  print(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase: MarketplaceShipmentPurchaseReceipt,
    generation: MarketplaceShipmentGenerationReceipt): Promise<MarketplaceShipmentPrintResult | undefined>;
  cancel(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase: MarketplaceShipmentPurchaseReceipt,
    generation: MarketplaceShipmentGenerationReceipt | null, reason: MarketplaceShipmentCancellationReason): Promise<MarketplaceShipmentCancellationEvidence>;
  reconcileCancellation(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase: MarketplaceShipmentPurchaseReceipt,
    generation: MarketplaceShipmentGenerationReceipt | null): Promise<MarketplaceShipmentCancellationEvidence>;
  tracking(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase?: MarketplaceShipmentPurchaseReceipt | null,
    generation?: MarketplaceShipmentGenerationReceipt | null): Promise<MarketplaceShipmentTrackingEvidence | undefined>;
}
