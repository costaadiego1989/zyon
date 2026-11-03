import { Logger, type OnModuleInit, type OnApplicationShutdown } from "@nestjs/common";
import type { GraphCatalogSourcesPort, GraphKnowledgeSourcesPort } from "../domain/public-graph-sources.port.js";
import type { DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import type { GraphRagRuntime } from "../graph-rag.module.js";

export class GraphRagSynchronization implements OnModuleInit, OnApplicationShutdown {
  private readonly running = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(GraphRagSynchronization.name);
  constructor(private readonly runtime: GraphRagRuntime, private readonly catalog: GraphCatalogSourcesPort,
    private readonly knowledge: GraphKnowledgeSourcesPort, private readonly events: DomainEventBus,
    private readonly tenant: TenantContextService) {}
  onModuleInit() {
    if (!this.runtime.settings.enabled) return;
    for (const eventType of ["product.upserted", "product.deleted", "product.content.updated", "support.faq_updated", "merchant.config_updated", "knowledge.policy_updated"]) {
      this.events.subscribe(eventType, async event => {
        await this.synchronize(event.merchantId);
      }, `graph-rag:${eventType}`);
    }
    this.timer = setInterval(() => { void this.reconcile(); }, 120_000);
    this.timer.unref();
    void this.reconcile();
  }
  async reconcile() { for (const merchantId of this.runtime.settings.merchantIds) await this.synchronize(merchantId); }
  async synchronize(merchantId: string): Promise<void> {
    if (!this.runtime.readyFor(merchantId)) return;
    const running = this.running.get(merchantId);
    if (running) return running;
    const work = this.tenant.run({ merchantId, userId: "graph-rag-sync", role: "system" }, async () => {
      try {
        const observedAt = Date.now(), sourceIds = new Set<string>();
        let cursor: string | undefined;
        const seen = new Set<string>();
        for (let page = 0; page < 100; page++) {
          const result = await this.catalog.page(merchantId, cursor);
          for (const source of result.sources) {
            if (source.merchantId !== merchantId) throw Error("graph_source_scope_mismatch");
            const outcome = await this.runtime.projection.projectCatalog(source);
            if (outcome.status === "unavailable") throw Error("graph_projection_incomplete");
            sourceIds.add(source.id);
          }
          if (!result.nextCursor) break;
          if (seen.has(result.nextCursor) || page === 99) throw Error("graph_projection_pagination_incomplete");
          seen.add(result.nextCursor);cursor = result.nextCursor;
        }
        await this.runtime.projection.retireMissingCatalog(merchantId, [...sourceIds], observedAt);
        for (const source of await this.knowledge.list(merchantId)) {
          if (source.merchantId !== merchantId) throw Error("graph_source_scope_mismatch");
          const outcome = await this.runtime.projection.projectDocument(source);
          if (outcome.status === "unavailable") throw Error("graph_projection_incomplete");
        }
      } catch { this.logger.warn("GraphRAG synchronization incomplete; canonical revalidation and freshness limits remain enforced"); }
    });
    this.running.set(merchantId, work);
    try { await work; } finally { this.running.delete(merchantId); }
  }
  async onApplicationShutdown() { if (this.timer) clearInterval(this.timer);await Promise.allSettled(this.running.values()); }
}
