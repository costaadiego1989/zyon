import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { CRM_PROVIDER_PORT, type CrmProviderPort } from "../../domain/ports/crm-provider.port.js";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";
import { CrmAdapterFactory } from "../../infrastructure/adapters/crm-adapter.factory.js";
import { decryptCrmSecret } from "../../infrastructure/adapters/crm-secret-cipher.js";

/**
 * Syncs sale data to CRM: upserts buyer contact and creates deal.
 * Fire-and-forget: errors logged, not thrown.
 * Resolves active CRM provider from CrmConnectionRepository and calls via factory.
 */
@Injectable()
export class CrmSyncService {
  private readonly logger = new Logger(CrmSyncService.name);

  constructor(
    @Optional() @Inject(CRM_PROVIDER_PORT) private readonly legacyCrm?: CrmProviderPort,
    @Optional() @Inject(CRM_CONNECTION_REPOSITORY) private readonly crmConnections?: CrmConnectionRepositoryPort,
    @Optional() private readonly adapterFactory?: CrmAdapterFactory
  ) {}

  async syncSale(event: SaleCompletedEvent): Promise<void> {
    if (!event.buyerEmail) {
      this.logger.debug(`[CRM] No buyer email; skipping CRM sync for orderId=${event.orderId}`);
      return;
    }

    // Resolve CRM adapter: first try new connection-based system, fallback to legacy single CRM
    let crm: CrmProviderPort | undefined;

    if (this.crmConnections && this.adapterFactory) {
      try {
        const connections = await this.crmConnections.list(event.merchantId);
        const activeConnection = connections.find((c) => c.status === "connected");

        if (activeConnection && activeConnection.accessTokenCipher) {
          // Decrypt token and create adapter
          const decryptedToken = decryptCrmSecret(activeConnection.accessTokenCipher);
          crm = this.adapterFactory.create({
            provider: activeConnection.provider,
            accessToken: decryptedToken,
          });
        }
      } catch (err: unknown) {
        this.logger.warn(`[CRM] Failed to resolve connection: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Fallback to legacy single CRM if no connection found
    if (!crm) {
      crm = this.legacyCrm;
    }

    if (!crm) {
      this.logger.debug(`[CRM] No CRM provider available; skipping`);
      return;
    }

    try {
      // Upsert contact
      await crm.upsertContact(event.merchantId, {
        email: event.buyerEmail,
        name: event.buyerName,
        phone: event.buyerPhone,
        tags: ["checkout_buyer"]
      });

      this.logger.debug(
        `[CRM] Contact upserted: merchantId=${event.merchantId}, email=${event.buyerEmail}`
      );

      // Create deal
      await crm.createDeal(event.merchantId, {
        contactEmail: event.buyerEmail,
        title: `Order ${event.orderId}`,
        valueCents: event.totalCents,
        stage: "won",
        metadata: {
          order_id: event.orderId,
          items_count: event.items.length,
          timestamp: event.timestamp
        }
      });

      this.logger.debug(
        `[CRM] Deal created: merchantId=${event.merchantId}, orderId=${event.orderId}, value=${event.totalCents / 100} BRL`
      );

      // Mark synced if using connection-based system
      if (this.crmConnections) {
        const connections = await this.crmConnections.list(event.merchantId);
        const activeConnection = connections.find((c) => c.status === "connected");
        if (activeConnection) {
          await this.crmConnections.markSynced(event.merchantId, activeConnection.id);
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[CRM] Failed to sync sale: ${errorMsg}`, {
        merchantId: event.merchantId,
        orderId: event.orderId,
        email: event.buyerEmail,
        error: err instanceof Error ? err.stack : undefined
      });
      // Do NOT throw: CRM sync failure should not block the sale event
    }
  }
}
