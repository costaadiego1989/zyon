import type { FiscalTenant } from "./fiscal-repository.port.js";

export interface FiscalStockBinding extends FiscalTenant {
  intentId: string; snapshotId: string; connectionId: string; erpConnectionId: string | null;
  orderId: string; contentHash: string; stockOwner: string; intentVersion: number;
  lines: { sku: string; quantity: number }[]; bindingCode: string; evidenceCode: string;
}
/** Internal worker port. Evidence IDs refer to already persisted authenticated reconciliation,
 * never a public confirmation or an authorization status without the stock effect proof. */
export interface FiscalStockPort {
  binding(scope: FiscalTenant, intentId: string): Promise<FiscalStockBinding>;
  /** Short consistency check only. The callback runs outside SQL transactions.
   * It must independently persist its journal begin under the current claim before IO. */
  withEffect<T>(scope: FiscalTenant, intentId: string, work: () => Promise<T>): Promise<T>;
  release(scope: FiscalTenant, intentId: string, evidenceEventId: string): Promise<void>;
}
