import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { INVENTORY_SALE_REPOSITORY, type InventorySaleRepositoryPort } from "../../domain/ports/inventory-sale.repository.port.js";
import { INVENTORY_SALE_JOBS } from "../repositories/prisma-inventory-sale.repository.js";
import { ErpStockPushService } from "../../application/services/erp-stock-push.service.js";
import { CrmSyncService } from "../../application/services/crm-sync.service.js";
import { InventoryWebhookEmitterService } from "../../application/services/inventory-webhook-emitter.service.js";

@Injectable()
export class InventorySaleIntegrationHandler implements OnModuleInit {
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(INVENTORY_SALE_REPOSITORY) private readonly sales: InventorySaleRepositoryPort,
    private readonly erp: ErpStockPushService, private readonly crm: CrmSyncService,
    private readonly webhooks: InventoryWebhookEmitterService) {}
  onModuleInit(): void {
    for (const [kind, eventType] of Object.entries(INVENTORY_SALE_JOBS)) {
      this.bus.subscribe(eventType, event => this.handle(kind, event), `inventory.sale.integration.${kind}.v1`);
    }
  }
  private async handle(kind: string, event: DomainEvent): Promise<void> {
    const payload = event.payload as { version?: number; receiptId?: string; kind?: string } | undefined;
    if (!payload || payload.version !== 1 || payload.kind !== kind || typeof payload.receiptId !== "string") throw new Error("inventory_integration_event_invalid");
    const sale = await this.sales.findReceipt(event.merchantId, payload.receiptId);
    if (!sale) throw new Error("inventory_sale_receipt_not_found");
    if (kind === "erp") await this.erp.pushStock(sale);
    else if (kind === "crm") await this.crm.syncSale(sale.event);
    else if (kind === "webhook") await this.webhooks.emitWebhooks(sale);
    else throw new Error("inventory_integration_kind_unsupported");
  }
}
