import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SyncMerchantProductsUseCase } from "../../application/use-cases/sync-merchant-products.use-case.js";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class SyncMarketplaceIndexJob implements OnModuleInit {
  private readonly logger = new Logger(SyncMarketplaceIndexJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly syncUseCase: SyncMerchantProductsUseCase) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.logger.debug("Marketplace index sync job scheduled (every 5 min)");
    }, SYNC_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
