import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { reconcileStockAlert } from "../repositories/reconcile-stock-alert.js";

@Injectable()
export class StockAlertMonitorJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockAlertMonitorJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  onModuleInit() { void this.run(); this.timer = setInterval(() => void this.run(), 5 * 60_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run() {
    if (this.running) return;
    this.running = true;
    let checked = 0, failed = 0;
    try {
      let cursor: string | undefined;
      do {
        const rows = await this.prisma.inventoryItem.findMany({ select: { id: true, merchantId: true },
          orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!rows.length) break;
        for (const row of rows) {
          try {
            await this.prisma.$transaction(tx => reconcileStockAlert(tx, row.merchantId, row.id));
            checked++;
          } catch { failed++; this.logger.error(`stock_alert_item_failed item=${row.id}`); }
        }
        cursor = rows[rows.length - 1].id;
        if (rows.length < 200) break;
      } while (true);
      this.logger.log(`stock_alert_monitor checked=${checked} failed=${failed}`);
    } catch { this.logger.error("stock_alert_monitor_failed"); }
    finally { this.running = false; }
    return { checked, failed };
  }
}
