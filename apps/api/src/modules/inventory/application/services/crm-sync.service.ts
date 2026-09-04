import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { CRM_PROVIDER_PORT, type CrmProviderPort } from "../../domain/ports/crm-provider.port.js";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";
import { CRM_SYNC_LOG_REPOSITORY, type CrmSyncLogRepositoryPort } from "../../domain/ports/crm-sync-log-repository.port.js";
import { CrmAdapterFactory } from "../../infrastructure/adapters/crm-adapter.factory.js";
import { decryptCrmSecret } from "../../infrastructure/adapters/crm-secret-cipher.js";

export interface CrmLeadEvent {
  merchantId: string;
  email: string;
  name?: string;
  phone?: string;
  sessionId?: string;
}

/**
 * Syncs buyers to the merchant's CRM:
 * - syncLead: buyer identified (registered) but not yet purchased → contact
 *   tagged "lead" + an open deal (once per email).
 * - syncSale: purchase completed → contact tagged "customer" + a won deal.
 * Fire-and-forget: errors are logged + recorded, never thrown. Every attempt is
 * written to the CrmSyncLog so the merchant can see leads vs customers.
 */
@Injectable()
export class CrmSyncService {
  private readonly logger = new Logger(CrmSyncService.name);

  constructor(
    @Optional() @Inject(CRM_PROVIDER_PORT) private readonly legacyCrm?: CrmProviderPort,
    @Optional() @Inject(CRM_CONNECTION_REPOSITORY) private readonly crmConnections?: CrmConnectionRepositoryPort,
    @Optional() private readonly adapterFactory?: CrmAdapterFactory,
    @Optional() @Inject(CRM_SYNC_LOG_REPOSITORY) private readonly syncLog?: CrmSyncLogRepositoryPort,
  ) {}

  /** Resolves the active connected CRM (provider + adapter) for a merchant. */
  private async resolveActive(
    merchantId: string,
  ): Promise<{ crm: CrmProviderPort; provider: string; connectionId?: string } | undefined> {
    if (this.crmConnections && this.adapterFactory) {
      try {
        const connections = await this.crmConnections.list(merchantId);
        const active = connections.find((c) => c.status === "connected");
        if (active?.accessTokenCipher) {
          const token = decryptCrmSecret(active.accessTokenCipher);
          const crm = this.adapterFactory.create({ provider: active.provider, accessToken: token });
          return { crm, provider: active.provider, connectionId: active.id };
        }
      } catch (err: unknown) {
        this.logger.warn(`[CRM] Failed to resolve connection: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (this.legacyCrm) return { crm: this.legacyCrm, provider: "legacy" };
    return undefined;
  }

  private async record(
    merchantId: string,
    provider: string,
    email: string,
    stage: "lead" | "customer",
    status: "success" | "failed",
    errorCode?: string,
  ): Promise<void> {
    try {
      await this.syncLog?.record({ merchantId, provider, email, stage, status, errorCode });
    } catch (err: unknown) {
      this.logger.warn(`[CRM] Failed to write sync log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async syncLead(event: CrmLeadEvent): Promise<void> {
    if (!event.email) return;
    const active = await this.resolveActive(event.merchantId);
    if (!active) {
      this.logger.debug(`[CRM] No CRM provider available; skipping lead sync`);
      return;
    }
    const { crm, provider } = active;

    try {
      await crm.upsertContact(event.merchantId, {
        email: event.email,
        name: event.name,
        phone: event.phone,
        tags: ["lead"],
      });

      // Create an open deal only the first time we see this lead's email, so
      // re-fills of the checkout form don't pile up duplicate open deals.
      const alreadyLead = this.syncLog ? await this.syncLog.hasLeadFor(event.merchantId, event.email) : false;
      if (!alreadyLead) {
        await crm.createDeal(event.merchantId, {
          contactEmail: event.email,
          title: `Lead — ${event.name || event.email}`,
          valueCents: 0,
          open: true,
          metadata: { session_id: event.sessionId },
        });
      }

      await this.record(event.merchantId, provider, event.email, "lead", "success");
      this.logger.debug(`[CRM] Lead synced: merchantId=${event.merchantId}, email=${event.email}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.record(event.merchantId, provider, event.email, "lead", "failed", msg.slice(0, 120));
      this.logger.warn(`[CRM] Failed to sync lead: ${msg}`, { merchantId: event.merchantId, email: event.email });
      // Do NOT throw.
    }
  }

  async syncSale(event: SaleCompletedEvent): Promise<void> {
    if (!event.buyerEmail) {
      this.logger.debug(`[CRM] No buyer email; skipping CRM sync for orderId=${event.orderId}`);
      return;
    }

    const active = await this.resolveActive(event.merchantId);
    if (!active) {
      this.logger.debug(`[CRM] No CRM provider available; skipping`);
      return;
    }
    const { crm, provider, connectionId } = active;

    try {
      await crm.upsertContact(event.merchantId, {
        email: event.buyerEmail,
        name: event.buyerName,
        phone: event.buyerPhone,
        tags: ["customer"],
      });

      await crm.createDeal(event.merchantId, {
        contactEmail: event.buyerEmail,
        title: `Order ${event.orderId}`,
        valueCents: event.totalCents,
        open: false,
        stage: "won",
        metadata: {
          order_id: event.orderId,
          items_count: event.items.length,
          timestamp: event.timestamp,
        },
      });

      if (this.crmConnections && connectionId) {
        await this.crmConnections.markSynced(event.merchantId, connectionId);
      }
      await this.record(event.merchantId, provider, event.buyerEmail, "customer", "success");
      this.logger.debug(`[CRM] Sale synced: merchantId=${event.merchantId}, orderId=${event.orderId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.record(event.merchantId, provider, event.buyerEmail, "customer", "failed", msg.slice(0, 120));
      this.logger.warn(`[CRM] Failed to sync sale: ${msg}`, {
        merchantId: event.merchantId,
        orderId: event.orderId,
        email: event.buyerEmail,
      });
      // Do NOT throw: CRM sync failure should not block the sale event
    }
  }
}
