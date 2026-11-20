import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { FiscalArtifactDescriptor, FiscalArtifactPort } from "../domain/fiscal-artifact.port.js";
import type { FiscalDocumentKind, FiscalProviderPort } from "../domain/fiscal-provider.js";
import type { FiscalTenant } from "../domain/fiscal-repository.port.js";
import { authorizedNfeWithKeyComponents, safeXml } from "./providers/provider-xml-evidence.js";
import { validateFiscalPdf } from "./fiscal-pdf.validation.js";
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const descriptor = (row: FiscalArtifactDescriptor): FiscalArtifactDescriptor => ({ id: row.id, kind: row.kind, sha256: row.sha256, size: row.size, mimeType: row.mimeType, retrievedAt: row.retrievedAt });
export class FiscalArtifactStore implements FiscalArtifactPort {
  constructor(private readonly prisma: PrismaClient) {}
  private async context(scope: FiscalTenant, documentId: string) {
    const document = await this.prisma.fiscalDocument.findFirst({ where: { ...scope, id: documentId }, include: { intent: { include: { connection: true } } } });
    if (!document) throw new Error("fiscal_document_not_found");
    if (!["authorized", "cancelled"].includes(document.state) || !document.authorizationProtocol || !document.authorizedAt || !document.accessKey || !document.number || !document.series || !document.intent.remoteInvoiceId) throw new Error("fiscal_artifact_not_authorized");
    const identity = { ...scope, connectionId: document.intent.connectionId, provider: document.intent.connection.provider, issuerTaxId: document.issuerTaxId, reference: document.intent.stableReference };
    return { document, identity };
  }
  async put(scope: FiscalTenant, documentId: string, kind: FiscalDocumentKind, artifact: { bytes: Uint8Array; mimeType: string }) {
    const { document, identity } = await this.context(scope, documentId);
    if (!["xml", "danfe"].includes(kind) || !(artifact.bytes instanceof Uint8Array) || !artifact.bytes.length || artifact.bytes.length > 20 * 1024 * 1024
      || !(kind === "xml" ? ["application/xml", "text/xml"] : ["application/pdf"]).includes(artifact.mimeType)) throw new Error("fiscal_artifact_invalid");
    const bytes = Uint8Array.from(artifact.bytes); const sha256 = hash(bytes);
    const existing = await this.prisma.fiscalArtifact.findFirst({ where: { ...scope, documentId, kind } });
    if (existing) { if (existing.sha256 !== sha256 || existing.size !== bytes.length || existing.mimeType !== artifact.mimeType) throw new Error("fiscal_artifact_immutable"); return descriptor(existing); }
    if (kind === "xml") {
      const auth = authorizedNfeWithKeyComponents(safeXml(bytes), identity, document.accessKey!);
      if (auth.number !== document.number || auth.series !== document.series || auth.protocol !== document.authorizationProtocol || Date.parse(auth.authorizedAt) !== document.authorizedAt!.getTime()) throw new Error("fiscal_artifact_authorization_mismatch");
    } else await validateFiscalPdf(bytes);
    return this.prisma.$transaction(async tx => {
      const current = await tx.fiscalDocument.findFirst({ where: { ...scope, id: documentId } });
      if (!current || current.authorizationProtocol !== document.authorizationProtocol || current.accessKey !== document.accessKey || !["authorized", "cancelled"].includes(current.state)) throw new Error("fiscal_artifact_authorization_mismatch");
      await tx.fiscalArtifact.createMany({ data: { id: randomUUID(), ...scope, documentId, kind, privateObjectKey: "fiscal/" + hash(JSON.stringify([scope, documentId])) + "/" + kind + "/" + sha256,
        content: Buffer.from(bytes), sha256, size: bytes.length, mimeType: artifact.mimeType, retrievedAt: new Date() }, skipDuplicates: true });
      const stored = await tx.fiscalArtifact.findFirstOrThrow({ where: { ...scope, documentId, kind } });
      if (stored.sha256 !== sha256 || stored.size !== bytes.length || stored.mimeType !== artifact.mimeType) throw new Error("fiscal_artifact_immutable");
      return descriptor(stored);
    });
  }
  async get(scope: FiscalTenant, documentId: string, kind: FiscalDocumentKind) {
    await this.context(scope, documentId);
    const stored = await this.prisma.fiscalArtifact.findFirst({ where: { ...scope, documentId, kind } }); if (!stored) return null;
    if (stored.size !== stored.content.length || hash(stored.content) !== stored.sha256) throw new Error("fiscal_artifact_integrity_failed");
    return { bytes: Uint8Array.from(stored.content), mimeType: stored.mimeType, sha256: stored.sha256 };
  }
  async capture(scope: FiscalTenant, documentId: string, provider: FiscalProviderPort, kind: FiscalDocumentKind) {
    const { document, identity } = await this.context(scope, documentId);
    const existing = await this.prisma.fiscalArtifact.findFirst({ where: { ...scope, documentId, kind } }); if (existing) return descriptor(existing);
    if (provider.provider !== identity.provider) throw new Error("fiscal_identity_mismatch");
    // Provider adapters enforce their documented fixed origin, manual redirects, authentication, streaming size and MIME.
    const artifact = await provider.download(identity, { remoteInvoiceId: document.intent.remoteInvoiceId!, kind, authorization: { number: document.number!, series: document.series!, accessKey: document.accessKey!, protocol: document.authorizationProtocol!, authorizedAt: document.authorizedAt!.toISOString() } });
    return this.put(scope, documentId, kind, artifact);
  }
}
