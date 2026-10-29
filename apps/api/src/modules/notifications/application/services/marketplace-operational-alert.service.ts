import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { parseMarketplaceOperationalAlerts } from "../../domain/marketplace-operational-alert.js";
import { PrismaMarketplaceOperationalAlertRepository } from "../../infrastructure/repositories/prisma-marketplace-operational-alert.repository.js";

@Injectable()
export class MarketplaceOperationalAlertService implements OnModuleInit {
  constructor(@Inject(PrismaMarketplaceOperationalAlertRepository) private readonly repo: PrismaMarketplaceOperationalAlertRepository,
    @Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus) {}
  onModuleInit() {
    this.bus.subscribe("marketplace.operational_alert.received", async event => {
      const p = event.payload as { alertId?: unknown; state?: unknown };
      if (!p || event.schemaVersion !== 1 || typeof p.alertId !== "string" || p.alertId !== event.eventId || !["firing","resolved"].includes(String(p.state)) ||
        !await this.repo.verifyEvent(p.alertId,event.merchantId,String(p.state))) throw new Error("operational_alert_outbox_scope_invalid");
      // Durable dispatcher completion admits the independent channel workers.
    }, "notifications:marketplace.operational_alert.received");
  }
  receive(payload: unknown, now = new Date()) {
    return this.repo.receive(parseMarketplaceOperationalAlerts(payload,process.env.MARKETPLACE_ALERT_MERCHANT_ID?.trim() ?? "",now),now);
  }
}
