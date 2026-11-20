import type { FiscalEnvironment } from "./fiscal-provider.js";
import type { FiscalConnectionRecord } from "./fiscal-configuration.port.js";
import type { FiscalProfileRecord } from "./fiscal-profile.port.js";
import type { FiscalTenant } from "./fiscal-repository.port.js";

export interface FiscalRawCommercialLine {
  lineId: string; sellerMerchantId: string; sku: string; name?: string; variantId?: string;
  productType: "physical" | "food" | "digital" | "service" | "unknown"; quantity: number; unitPriceCents: number;
}
export interface FiscalSnapshotLine extends FiscalRawCommercialLine {
  grossCents: number; discountCents: number; shippingCents: number; totalCents: number;
}
/** Monetary columns cover the seller's entire commercial parcel. Only lines may be invoiced.
 * Pending/excluded lines remain immutable evidence; revalidation derives from commercialLines. */
export interface FiscalSnapshotEnvelope {
  version: 1; sessionId: string; connectionId: string; erpConnectionId?: string | null; profileVersionId: string | null;
  buyerContacts: { name?: string; email?: string; phone?: string };
  commercialLines: FiscalSnapshotLine[]; lines: FiscalSnapshotLine[]; excludedLines: FiscalSnapshotLine[]; pendingLines: FiscalSnapshotLine[];
  readinessCode: string | null; policy: { stockOwner: string; emailOwner: string; whatsappOwner: string };
  fiscalTotals: { subtotalCents: number; discountCents: number; shippingCents: number; totalCents: number };
}
export interface FiscalSnapshotCapture {
  orderMerchantId: string; completedOrderId: string; orderId: string; completedAt: Date; sessionId: string;
  buyerGlobalUserId?: string; currency: string; recipient: unknown; lines: readonly FiscalRawCommercialLine[];
  buyerContacts?: { name?: string; email?: string; phone?: string };
  discountCents: number; shippingCents: number; totalCents: number; paymentProofRef: string | null;
}
export interface FiscalSnapshotContext extends FiscalTenant { connection: FiscalConnectionRecord; profile: FiscalProfileRecord | null }
export interface FiscalSnapshotCreate extends FiscalTenant {
  orderMerchantId: string; completedOrderId: string; orderId: string; completedAt: Date; buyerGlobalUserId?: string;
  currency: string; recipient: unknown; items: FiscalSnapshotEnvelope;
  subtotalCents: number; discountCents: number; shippingCents: number; totalCents: number;
  paymentProofRef: string | null; contentHash: string;
}
export interface FiscalSnapshotRecord extends Omit<FiscalSnapshotCreate, "recipient" | "items" | "buyerGlobalUserId"> {
  id: string; recipient: unknown; items: unknown; buyerGlobalUserId: string | null;
}
export interface FiscalSnapshotStore {
  find(scope: FiscalTenant, orderId: string): Promise<FiscalSnapshotRecord | null>;
  persist(input: readonly FiscalSnapshotCreate[]): Promise<FiscalSnapshotRecord[]>;
}
export function readFiscalSnapshotEnvelope(value: unknown): FiscalSnapshotEnvelope {
  const envelope = value as FiscalSnapshotEnvelope;
  if (envelope?.version !== 1 || !Array.isArray(envelope.commercialLines) || !Array.isArray(envelope.lines)
    || !Array.isArray(envelope.pendingLines) || !Array.isArray(envelope.excludedLines) || !envelope.policy) throw new Error("fiscal_snapshot_invalid");
  return structuredClone(envelope);
}
export type FiscalSnapshotEnvironment = FiscalEnvironment;
