import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY, type RecoveryLifecycleRepository } from "../domain/ports/recovery-template-lifecycle.port.js";
import { RecoveryTemplateLifecycleUseCase } from "../application/use-cases/recovery-template-lifecycle.use-case.js";

@Injectable()
export class RecoveryTemplateMonitorJob implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private cursor?: string;
  private readonly logger = new Logger(RecoveryTemplateMonitorJob.name);
  constructor(
    @Inject(RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY) private readonly repo: RecoveryLifecycleRepository,
    private readonly lifecycle: RecoveryTemplateLifecycleUseCase,
  ) {}
  onModuleInit() { this.timer = setInterval(() => void this.runOnce(), 60_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      try { this.cursor = await this.repo.seedMerchantPage(this.cursor); }
      catch { this.logger.warn("Recovery template seeding failed; approval polling will continue"); }
      await this.lifecycle.processDue();
    } catch { this.logger.warn("Recovery template monitor failed; next cycle will resume persisted work"); }
    finally { this.running = false; }
  }
}
