import { Injectable, Logger } from "@nestjs/common";
import { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";

/**
 * Phase 2: no-op CRM adapter. Logs upsertContact and createDeal calls for audit.
 * Real adapters (HubSpot, Pipedrive, etc.) implemented when CRM integration is funded.
 */
@Injectable()
export class NoopCrmAdapter implements CrmProviderPort {
  private readonly logger = new Logger(NoopCrmAdapter.name);

  async upsertContact(merchantId: string, contact: CrmContact): Promise<void> {
    this.logger.debug(`[NOOP] upsertContact: merchantId=${merchantId}, email=${contact.email}, name=${contact.name}`);
  }

  async createDeal(merchantId: string, deal: CrmDeal): Promise<void> {
    this.logger.debug(`[NOOP] createDeal: merchantId=${merchantId}, contactEmail=${deal.contactEmail}, title=${deal.title}, valueCents=${deal.valueCents}`);
  }
}
