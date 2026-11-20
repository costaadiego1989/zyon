import type { FiscalDocumentKind, FiscalProviderPort } from "./fiscal-provider.js";
import type { FiscalTenant } from "./fiscal-repository.port.js";
export interface FiscalArtifactDescriptor { id: string; kind: string; sha256: string; size: number; mimeType: string; retrievedAt: Date }
export interface FiscalArtifactPort {
  put(scope: FiscalTenant, documentId: string, kind: FiscalDocumentKind, artifact: { bytes: Uint8Array; mimeType: string }): Promise<FiscalArtifactDescriptor>;
  get(scope: FiscalTenant, documentId: string, kind: FiscalDocumentKind): Promise<{ bytes: Uint8Array; mimeType: string; sha256: string } | null>;
  capture(scope: FiscalTenant, documentId: string, provider: FiscalProviderPort, kind: FiscalDocumentKind): Promise<FiscalArtifactDescriptor>;
}
