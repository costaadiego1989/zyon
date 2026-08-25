import { Injectable, Logger } from "@nestjs/common";
import { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";

/**
 * RD Station CRM adapter using REST API.
 * Fire-and-forget: errors logged, not thrown.
 */
@Injectable()
export class RdStationCrmAdapter implements CrmProviderPort {
  private readonly logger = new Logger(RdStationCrmAdapter.name);
  private readonly baseUrl = "https://crm.rdstation.com/api/v1";

  constructor(private readonly accessToken: string) {}

  async upsertContact(merchantId: string, contact: CrmContact): Promise<void> {
    try {
      const payload = {
        email: contact.email,
        name: contact.name || contact.email,
        mobile: contact.phone || undefined,
      };

      const response = await fetch(
        `${this.baseUrl}/contacts?token=${encodeURIComponent(this.accessToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        this.logger.warn(
          `[RD Station] upsertContact failed: ${response.status} - ${err}`,
          { merchantId, email: contact.email }
        );
        return;
      }

      this.logger.debug(`[RD Station] Contact upserted: ${contact.email}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[RD Station] upsertContact error: ${errorMsg}`, {
        merchantId,
        email: contact.email,
      });
    }
  }

  async createDeal(merchantId: string, deal: CrmDeal): Promise<void> {
    try {
      const payload = {
        name: deal.title,
        contact_email: deal.contactEmail,
        amount: deal.valueCents / 100,
        currency: "BRL",
        stage: deal.stage || "open",
      };

      const response = await fetch(
        `${this.baseUrl}/deals?token=${encodeURIComponent(this.accessToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        this.logger.warn(`[RD Station] createDeal failed: ${response.status} - ${err}`, {
          merchantId,
          dealTitle: deal.title,
        });
        return;
      }

      this.logger.debug(`[RD Station] Deal created: ${deal.title} (${deal.valueCents / 100} BRL)`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[RD Station] createDeal error: ${errorMsg}`, {
        merchantId,
        dealTitle: deal.title,
      });
    }
  }
}
