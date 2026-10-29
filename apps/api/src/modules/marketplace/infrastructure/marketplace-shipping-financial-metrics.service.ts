import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Counter, Gauge } from "prom-client";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES } from "../../shipping/domain/marketplace-shipment-journal.js";

/** Includes generated labels held for financial reconciliation, independently of shipping status. */
@Injectable()
export class MarketplaceShippingFinancialMetricsService {
  private readonly logger = new Logger(MarketplaceShippingFinancialMetricsService.name);
  private readonly holds: Gauge;
  private readonly collected: Gauge;
  private readonly errors: Counter;
  private pending?: Promise<void>;
  constructor(private readonly prisma: PrismaClient, metrics: MetricsService) {
    const registers = [metrics.registry], collect = () => this.refresh();
    this.holds = new Gauge({ name: "marketplace_shipping_financial_holds",
      help: "Durable carrier financial holds across all shipment statuses; reconciliation does not release stock or money",
      labelNames: ["reason"], registers, collect });
    this.collected = new Gauge({ name: "marketplace_shipping_financial_collected_timestamp_seconds",
      help: "Last successful collection of durable carrier financial holds", registers, collect });
    this.errors = new Counter({ name: "marketplace_shipping_financial_collection_errors_total",
      help: "Failed carrier financial hold metric collections", registers });
    this.collected.set(0);
  }
  refresh(): Promise<void> {
    if (!this.pending) this.pending = this.read().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async read(): Promise<void> {
    try {
      const rows = await this.prisma.marketplaceShipmentJournal.groupBy({ by: ["blockReason"],
        where: { blockReason: { in: [...MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES] } }, _count: { _all: true } });
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row.blockReason || !(MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES as readonly string[]).includes(row.blockReason) ||
            seen.has(row.blockReason) || !Number.isSafeInteger(row._count._all) || row._count._all < 0) throw Error("invalid_shipping_financial_snapshot");
        seen.add(row.blockReason);
      }
      // Replace only a complete validated snapshot; failure retains the last good values and timestamp.
      this.holds.reset();
      for (const reason of MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES) this.holds.set({ reason }, rows.find(row => row.blockReason === reason)?._count._all ?? 0);
      this.collected.set(Date.now() / 1000);
    } catch {
      this.errors.inc(); this.logger.warn({ event: "marketplace_shipping_financial_metrics_failed" });
    }
  }
}
