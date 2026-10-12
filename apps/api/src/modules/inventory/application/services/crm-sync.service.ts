import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { CRM_PROVIDER_PORT, type CrmProviderPort } from "../../domain/ports/crm-provider.port.js";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";
import { CRM_SYNC_LOG_REPOSITORY, type CrmSyncLogRepositoryPort, type CrmSyncStatus } from "../../domain/ports/crm-sync-log-repository.port.js";
import { CrmAdapterFactory } from "../../infrastructure/adapters/crm-adapter.factory.js";
import { decryptCrmSecret } from "../../infrastructure/adapters/crm-secret-cipher.js";
import { CampaignContactConsentService } from "../../../campaign-consent/campaign-contact-consent.service.js";
import { HubSpotOAuthService } from "./hubspot-oauth.service.js";

export interface CrmLeadEvent {
  merchantId: string;
  email: string;
  name?: string;
  phone?: string;
  sessionId?: string;
}
interface Destination {
  provider: string;
  connectionId?: string;
  resolve: () => CrmProviderPort | Promise<CrmProviderPort>;
}

/** Each destination gets its own result. Durable sale deliveries retry failures. */
@Injectable()
export class CrmSyncService {
  private readonly logger = new Logger(CrmSyncService.name);
  constructor(
    @Optional() @Inject(CRM_PROVIDER_PORT) private readonly legacyCrm?: CrmProviderPort,
    @Optional() @Inject(CRM_CONNECTION_REPOSITORY) private readonly crmConnections?: CrmConnectionRepositoryPort,
    @Optional() private readonly adapterFactory?: CrmAdapterFactory,
    @Optional() @Inject(CRM_SYNC_LOG_REPOSITORY) private readonly syncLog?: CrmSyncLogRepositoryPort,
    @Optional() private readonly campaignConsent?: CampaignContactConsentService,
    @Optional() private readonly hubspotOAuth?: HubSpotOAuthService,
  ) {}

  private async destinations(merchantId: string): Promise<Destination[]> {
    if (this.crmConnections && this.adapterFactory) {
      const connections = await this.crmConnections.list(merchantId);
      return connections.filter(c => ["connected", "error"].includes(c.status)).map(c => ({
        provider: c.provider, connectionId: c.id,
        resolve: async () => {
          const accessToken = c.provider === "hubspot" && c.config?.authType === "oauth" ?
            await this.hubspotOAuth?.accessToken(c) : c.accessTokenCipher ? decryptCrmSecret(c.accessTokenCipher) : undefined;
          return this.adapterFactory!.create({ provider: c.provider, accessToken, config: c.config ?? undefined });
        },
      }));
    }
    return this.legacyCrm ? [{ provider: "legacy", resolve: () => this.legacyCrm! }] : [];
  }

  private async record(merchantId: string, provider: string, email: string, stage: "lead" | "customer",
    status: CrmSyncStatus, errorCode?: string): Promise<void> {
    await this.syncLog?.record({ merchantId, provider, email, stage, status, errorCode });
  }
  private async permitted(crm: CrmProviderPort, merchantId: string, email: string): Promise<boolean> {
    return crm.category !== "marketing" || (await this.campaignConsent?.canContactEmail({ merchantId, email })) === true;
  }
  private async failed(merchantId: string, destination: Destination, email: string, stage: "lead" | "customer") {
    try {
      await this.record(merchantId, destination.provider, email, stage, "failed", "inventory_crm_provider_failed");
      if (destination.connectionId) await this.crmConnections?.markError(merchantId, destination.connectionId, "inventory_crm_provider_failed");
    } catch { this.logger.warn("CRM failure could not be recorded"); }
    this.logger.warn(`CRM synchronization failed for ${destination.provider}`);
  }

  async syncLead(event: CrmLeadEvent): Promise<void> {
    if (!event.email?.trim()) return;
    const email = event.email.trim().toLowerCase();
    let targets: Destination[];
    try { targets = await this.destinations(event.merchantId); }
    catch { this.logger.warn("CRM connections unavailable for lead synchronization"); return; }
    for (const destination of targets) {
      try {
        const crm = await destination.resolve();
        if (!(await this.permitted(crm, event.merchantId, email))) {
          await this.record(event.merchantId, destination.provider, email, "lead", "skipped", "contact_consent_not_granted");
          continue;
        }
        await crm.upsertContact(event.merchantId, { email, name: event.name, phone: event.phone, tags: ["lead"] });
        if (crm.createDeal && !(await this.syncLog?.hasLeadFor(event.merchantId, email, destination.provider))) {
          await crm.createDeal(event.merchantId, { contactEmail: email, title: `Lead — ${event.name || email}`,
            valueCents: 0, open: true, metadata: { session_id: event.sessionId } });
        }
        await this.record(event.merchantId, destination.provider, email, "lead", "success");
        if (destination.connectionId) await this.crmConnections?.markSynced(event.merchantId, destination.connectionId);
      } catch { await this.failed(event.merchantId, destination, email, "lead"); }
    }
  }
  async syncSale(event: SaleCompletedEvent): Promise<void> {
    if (!event.buyerEmail?.trim()) return;
    const email = event.buyerEmail.trim().toLowerCase();
    let targets: Destination[];
    try { targets = await this.destinations(event.merchantId); }
    catch { throw new Error("inventory_crm_sync_failed"); }
    let failed = false;
    for (const destination of targets) {
      try {
        const crm = await destination.resolve();
        if (!(await this.permitted(crm, event.merchantId, email))) {
          await this.record(event.merchantId, destination.provider, email, "customer", "skipped", "contact_consent_not_granted");
          continue;
        }
        await crm.upsertContact(event.merchantId, { email, name: event.buyerName, phone: event.buyerPhone, tags: ["customer"] });
        await crm.createDeal?.(event.merchantId, { contactEmail: email, title: `Order ${event.orderId}`,
          valueCents: event.totalCents, open: false,
          metadata: { order_id: event.orderId, items_count: event.items.length, timestamp: event.timestamp } });
        await this.record(event.merchantId, destination.provider, email, "customer", "success");
        if (destination.connectionId) await this.crmConnections?.markSynced(event.merchantId, destination.connectionId);
      } catch {
        failed = true;
        await this.failed(event.merchantId, destination, email, "customer");
      }
    }
    if (failed) throw new Error("inventory_crm_sync_failed");
  }
}
