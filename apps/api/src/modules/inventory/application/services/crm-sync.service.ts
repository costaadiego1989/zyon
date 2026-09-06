import { Injectable, Inject } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";
import { CrmAdapterFactory } from "../../infrastructure/adapters/crm-adapter.factory.js";
import { decryptCrmSecret } from "../../infrastructure/adapters/crm-secret-cipher.js";

@Injectable()
export class CrmSyncService {
  constructor(@Inject(CRM_CONNECTION_REPOSITORY) private readonly connections: CrmConnectionRepositoryPort,
    private readonly factory: CrmAdapterFactory) {}
  async syncSale(event: SaleCompletedEvent): Promise<void> {
    if (!event.buyerEmail) throw new Error("inventory_crm_buyer_email_unavailable");
    const active = (await this.connections.list(event.merchantId)).filter(connection => connection.status === "connected");
    if (active.length !== 1 || !active[0]!.accessTokenCipher) throw new Error("inventory_crm_connection_missing_or_ambiguous");
    const connection = active[0]!;
    const crm = this.factory.create({ provider: connection.provider, accessToken: decryptCrmSecret(connection.accessTokenCipher!) });
    await crm.upsertContact(event.merchantId, { email: event.buyerEmail, name: event.buyerName, phone: event.buyerPhone, tags: ["checkout_buyer"] });
    await crm.createDeal(event.merchantId, { contactEmail: event.buyerEmail, title: `Order ${event.orderId}`,
      valueCents: event.totalCents, stage: "won", metadata: { order_id: event.orderId, items_count: event.items.length, timestamp: event.timestamp } });
    await this.connections.markSynced(event.merchantId, connection.id);
  }
}
