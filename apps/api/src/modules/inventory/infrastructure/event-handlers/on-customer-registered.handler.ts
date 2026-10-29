import { Injectable, OnModuleInit, Inject, Logger } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { CrmSyncService } from "../../application/services/crm-sync.service.js";

/**
 * Listens to `customer.registered` (emitted by the embed module when a buyer is
 * fully identified) and syncs them to the CRM as a LEAD — contact + open deal —
 * before any purchase. Completed sales are handled separately by
 * InventoryOnOrderCompletedHandler → syncSale.
 */
@Injectable()
export class InventoryOnCustomerRegisteredHandler implements OnModuleInit {
  private readonly logger = new Logger(InventoryOnCustomerRegisteredHandler.name);

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly crmSync: CrmSyncService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "customer.registered",
      (event) => this.handle(event),
      "inventory.InventoryOnCustomerRegisteredHandler",
    );
  }

  private async handle(event: DomainEvent): Promise<void> {
    const p = event.payload as Record<string, unknown>;
    const email = (p["email"] as string | undefined)?.trim();
    if (!email) return;

    await this.crmSync.syncLead({
      merchantId: event.merchantId,
      email,
      name: (p["full_name"] as string | undefined) ?? undefined,
      phone: (p["phone"] as string | undefined) ?? undefined,
      sessionId: (p["session_id"] as string | undefined) ?? undefined,
    });
  }
}
