import type { FiscalIssuanceContext } from "./fiscal-issuance.port.js";
import type { FiscalIdentity } from "./fiscal-provider.js";
export interface FiscalStockEffectEvidence {
  identity: FiscalIdentity; intentId: string; snapshotHash: string; remoteOrderId: string; remoteInvoiceId: string;
  lines: { sku: string; quantity: number }[]; evidenceReference: string;
}
export type FiscalStockEvidenceResult = { found: true; evidence: FiscalStockEffectEvidence } | { found: false; reasonCode: string };
export interface FiscalStockEvidencePort {
  read(context: FiscalIssuanceContext, payload: Readonly<Record<string, unknown>>, remoteInvoiceId: string, remoteOrderId?: string): Promise<FiscalStockEvidenceResult>;
}
