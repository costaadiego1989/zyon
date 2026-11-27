import type { FiscalTenant } from "./fiscal-repository.port.js";
export type FiscalDocumentActor = { kind: "buyer"; globalUserId: string } | { kind: "merchant"; merchantId: string; actorId: string; permissions: readonly string[] };
export interface FiscalDocumentProjection {
  intentId: string; merchantId: string; environment: FiscalTenant["environment"]; orderId: string; state: string;
  document: null | { id: string; state: string; documentState: string; number: string | null; series: string | null; accessKey: string | null;
    authorizationProtocol: string | null; authorizedAt: Date | null; cancellationProtocol: string | null; cancelledAt: Date | null;
    artifacts: { kind: string; sha256: string; size: number; mimeType: string }[] };
}
export interface FiscalDocumentAccessPort {
  find(actor: FiscalDocumentActor, scope: FiscalTenant, intentId: string): Promise<FiscalDocumentProjection | null>;
  order(actor: FiscalDocumentActor, input: FiscalTenant & { orderId: string }): Promise<FiscalDocumentProjection[] | null>;
  internal(scope: FiscalTenant, intentId: string): Promise<FiscalDocumentProjection | null>;
  documentState(scope: FiscalTenant, documentId: string, state: "available" | "document_pending"): Promise<void>;
}
