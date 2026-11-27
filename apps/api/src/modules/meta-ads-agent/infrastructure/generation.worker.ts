import type { MetaAdsRepository, Clock } from "../domain/types.js";
import type { GenerationService } from "../application/generation.service.js";
export class GenerationWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping = false;
  constructor(private readonly repo: MetaAdsRepository, private readonly generation: Pick<GenerationService, "run" | "recoverStalled">, private readonly enabled: boolean, private readonly clock: Clock = () => new Date()) {}
  onModuleInit(): void { if (this.enabled) { this.timer = setInterval(() => { void this.drain(); }, 3000); this.timer.unref(); void this.drain(); } }
  async onModuleDestroy(): Promise<void> { this.stopping = true; clearInterval(this.timer); await this.active; }
  drain(): Promise<void> { if (this.stopping) return Promise.resolve(); return this.active ??= this.process().catch(() => undefined).finally(() => { this.active = undefined; }); }
  private async process(): Promise<void> {
    for (const job of await this.repo.listPendingGenerations(20)) { if (this.stopping) return; try { await this.generation.run(job.merchantId, job.generationId); } catch { /* Durable reservations remain recoverable. */ } }
    let after: string | undefined;
    while (!this.stopping) {
      const stores = await this.repo.listStoreIds(100, after); if (!stores.length) return;
      for (const merchantId of stores) {
        const state = await this.repo.read(merchantId); const before = new Date(this.clock().getTime() - 10 * 60000);
        for (const job of Object.values(state.generations)) if (job.status === "running" && new Date(job.updatedAt) < before) await this.generation.recoverStalled(merchantId, job.id, before);
      }
      if (stores.length < 100) return; after = stores.at(-1);
    }
  }
}
