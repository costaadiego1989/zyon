import { createHash } from "node:crypto";
import type { GraphKnowledgeSourcesPort, GraphPublicDocumentSource } from "../../graph-rag/domain/public-graph-sources.port.js";
import type { PublicSupportFaqPort } from "../../support/domain/ports/public-support-faq.port.js";
import type { MerchantPolicyData } from "../domain/ports/policy-repository.port.js";
import { PUBLIC_POLICY_LABELS } from "../domain/public-knowledge-content.js";

export interface PublicPolicySnapshotPort {
  publicSnapshot(merchantId: string): Promise<{ merchantId: string; version: number; policy: MerchantPolicyData }>;
}
const fields = ["returns", "shipping", "warranty", "payment", "general"] as const;
const chunkId = (source: string, text: string) => createHash("sha256").update(source + "\0" + text).digest("hex");
export class PublishedGraphKnowledgeSources implements GraphKnowledgeSourcesPort {
  constructor(private readonly policies: PublicPolicySnapshotPort, private readonly faq: PublicSupportFaqPort) {}
  private document(merchantId: string, version: number, sourceType: "faq" | "policy", id: string,
    texts: string[]): GraphPublicDocumentSource {
    const chunks = texts.flatMap(text => {
      const parts: string[] = [];
      for (let start = 0; start < text.length; start += 7500) parts.push(text.slice(start, start + 7500));
      return parts;
    }).map(content => ({ id: chunkId(id, content), content }));
    // Identical public text need only be indexed once.
    return { kind: "knowledge", merchantId, id, version, sourceType, active: chunks.length > 0,
      chunks: [...new Map(chunks.map(chunk => [chunk.id, chunk])).values()] };
  }
  async read(merchantId: string, sourceType: "faq" | "policy", sourceId: string) {
    if (sourceType === "faq") {
      if (sourceId !== "faq-collection") return null;
      const snapshot = await this.faq.snapshot(merchantId);
      if (snapshot.merchantId !== merchantId) return null;
      return this.document(merchantId, snapshot.version, "faq", sourceId,
        snapshot.items.map(item => `P: ${item.question}\nR: ${item.answer}`));
    }
    if (!fields.includes(sourceId as typeof fields[number])) return null;
    const snapshot = await this.policies.publicSnapshot(merchantId);
    if (snapshot.merchantId !== merchantId) return null;
    const content = snapshot.policy[sourceId as typeof fields[number]]?.trim();
    return this.document(merchantId, snapshot.version, "policy", sourceId,
      content ? [`${PUBLIC_POLICY_LABELS[sourceId as keyof typeof PUBLIC_POLICY_LABELS]}: ${content}`] : []);
  }
  async list(merchantId: string) {
    const documents = await Promise.all([this.read(merchantId, "faq", "faq-collection"),
      ...fields.map(field => this.read(merchantId, "policy", field))]);
    return documents.filter((source): source is GraphPublicDocumentSource => source !== null);
  }
}
