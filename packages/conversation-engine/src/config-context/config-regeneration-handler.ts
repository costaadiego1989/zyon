/**
 * Config Regeneration Handler — async, event-driven document rebuild.
 *
 * Triggers on config updates, rebuilds document + embedding, stores result.
 * Debounced (max 1 per 30s per merchant) to prevent regeneration storms.
 * Never blocks caller (async via queue).
 */

import type { MerchantConfigDocument } from "./config-document-builder.js";
import type { EmbeddingServicePort } from "./embedding-service.js";
import type { ConfigEmbeddingRepository, ConfigSources } from "./config-embedding-repository.js";

export type ConfigEventType =
  | "checkout_settings.updated"
  | "merchant_theme.updated"
  | "agent_rules.updated"
  | "negotiation_policy.updated"
  | "support_settings.updated"
  | "commerce_connection.updated";

export interface ConfigDocumentBuilderPort {
  build(sources: ConfigSources): Promise<MerchantConfigDocument>;
}

export interface ConfigRegenerationHandlerDeps {
  builder: ConfigDocumentBuilderPort;
  embeddingService: EmbeddingServicePort;
  repository: ConfigEmbeddingRepository;
  debounceMs?: number;
}

export class ConfigRegenerationHandler {
  private readonly builder: ConfigDocumentBuilderPort;
  private readonly embeddingService: EmbeddingServicePort;
  private readonly repository: ConfigEmbeddingRepository;
  private readonly debounceMs: number;
  private lastRun = new Map<string, number>();
  private inflight = new Map<string, Promise<void>>();

  constructor(deps: ConfigRegenerationHandlerDeps) {
    this.builder = deps.builder;
    this.embeddingService = deps.embeddingService;
    this.repository = deps.repository;
    this.debounceMs = deps.debounceMs ?? 30_000;
  }

  async handle(eventType: ConfigEventType, sources: ConfigSources): Promise<void> {
    // Debounce check.
    const now = Date.now();
    const lastRunAt = this.lastRun.get(sources.merchantId) ?? 0;
    if (now - lastRunAt < this.debounceMs) {
      return; // Skipped due to debounce.
    }
    this.lastRun.set(sources.merchantId, now);

    // Async rebuild (fire-and-forget; never blocks caller).
    // Track the promise so callers (e.g. tests) can await completion if needed.
    const promise = this.rebuild(sources).catch(() => {
      // Silent fail: embedding or storage errors do not propagate.
      // The system will retry on the next trigger (within debounce window).
    });
    this.inflight.set(sources.merchantId, promise);
    promise.finally(() => {
      if (this.inflight.get(sources.merchantId) === promise) {
        this.inflight.delete(sources.merchantId);
      }
    });
  }

  /**
   * Wait for any inflight rebuild to complete (used by tests / shutdown).
   */
  async flush(merchantId?: string): Promise<void> {
    if (merchantId) {
      const p = this.inflight.get(merchantId);
      if (p) await p;
      return;
    }
    await Promise.all([...this.inflight.values()]);
  }

  private async rebuild(sources: ConfigSources): Promise<void> {
    // Step 1: Build document.
    const doc = await this.builder.build(sources);

    // Step 2: Generate embedding (may return null if service unavailable).
    const embeddingResult = await this.embeddingService.embed(doc.documentText);
    const embedding = embeddingResult?.vector ?? [];

    // Step 3: Store record (always store, even if embedding is empty).
    await this.repository.upsert({
      merchantId: sources.merchantId,
      documentText: doc.documentText,
      embeddingVector: embedding,
      version: doc.version,
      updatedAt: doc.generatedAt
    });
  }
}
