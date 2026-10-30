import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ShippingWalletService } from "./shipping-wallet.service.js";

@Injectable()
export class ShippingWalletMonitorJob implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(ShippingWalletMonitorJob.name);
  constructor(private readonly wallet: ShippingWalletService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.run(), 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run() {
    if (this.running) return;
    this.running = true;
    try { await this.wallet.monitor(); }
    catch { this.logger.error("shipping_wallet_monitor_failed"); }
    finally { this.running = false; }
  }
}
