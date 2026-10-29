/**
 * Config Embedding Repository — port + in-memory implementation.
 *
 * Port defines the storage contract for merchant config documents + embeddings.
 * The in-memory impl serves as a test double (per CLAUDE.md invariants).
 */

export interface MerchantConfigEmbeddingRecord {
  merchantId: string;
  documentText: string;
  embeddingVector: number[];
  version: number;
  updatedAt: Date;
}

export interface ConfigEmbeddingRepository {
  upsert(record: MerchantConfigEmbeddingRecord): Promise<void>;
  getByMerchantId(merchantId: string): Promise<MerchantConfigEmbeddingRecord | null>;
  searchSimilar(vector: number[], limit: number): Promise<MerchantConfigEmbeddingRecord[]>;
}

export const CONFIG_EMBEDDING_REPOSITORY = Symbol("CONFIG_EMBEDDING_REPOSITORY");

/** Input sources required to build the config document. */
export interface ConfigSources {
  merchantId: string;
  storeName: string;
  storeUrl: string;
  provider: string;
  theme: {
    accentColor: string;
    secondaryColor?: string;
    textColor: string;
    backgroundColor: string;
    fontFamily: string;
    density?: string;
    agentName?: string;
    trustBadges?: string[];
  };
  settings: {
    mode: string;
    openWidgetOnTrigger: boolean;
    cooldownSeconds: number;
    maxInterventionsPerSession: number;
  };
  rules: {
    maxDiscountPercent: number;
    minimumMarginPercent: number;
    brandVoice: string;
    blockedPhrases?: string[];
    requiredDisclaimers?: string[];
  };
  policy: {
    enabled: boolean;
    minOfferDiscountPercent: number;
    maxDiscountPercent: number;
    maxRounds: number;
    maxAiCostCents?: number;
  };
  faq: Array<{ id: string; question: string; answer: string }>;
  customGuardrails: string[];
}

// ─── In-Memory Implementation (test double) ──────────────────────────────────

export class InMemoryConfigEmbeddingRepository implements ConfigEmbeddingRepository {
  private store = new Map<string, MerchantConfigEmbeddingRecord>();

  async upsert(record: MerchantConfigEmbeddingRecord): Promise<void> {
    this.store.set(record.merchantId, record);
  }

  async getByMerchantId(merchantId: string): Promise<MerchantConfigEmbeddingRecord | null> {
    return this.store.get(merchantId) ?? null;
  }

  async searchSimilar(vector: number[], limit: number): Promise<MerchantConfigEmbeddingRecord[]> {
    // Simple cosine-similarity search for tests.
    const entries = [...this.store.values()];
    if (entries.length === 0 || vector.length === 0) return [];

    const scored = entries
      .filter((e) => e.embeddingVector.length === vector.length)
      .map((e) => ({ record: e, score: cosineSimilarity(vector, e.embeddingVector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((s) => s.record);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
