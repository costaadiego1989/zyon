import { Injectable, Logger } from "@nestjs/common";
import { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";

/**
 * Pipedrive CRM adapter using REST API.
 * Fire-and-forget: errors logged, not thrown.
 */
@Injectable()
export class PipedriveCrmAdapter implements CrmProviderPort {
  private readonly logger = new Logger(PipedriveCrmAdapter.name);
  private readonly baseUrl = "https://api.pipedrive.com/v1";

  constructor(private readonly apiToken: string) {}

  async upsertContact(merchantId: string, contact: CrmContact): Promise<void> {
    try {
      // Step 1: search person by email
      const searchResponse = await fetch(
        `${this.baseUrl}/persons/search?term=${encodeURIComponent(contact.email)}&fields=email&api_token=${this.apiToken}`,
        { method: "GET" }
      );

      let personId: string | null = null;

      if (searchResponse.ok) {
        const searchData = (await searchResponse.json()) as any;
        personId = searchData.data?.items?.[0]?.item?.id;
      }

      // Step 2: create or update person
      const method = personId ? "PUT" : "POST";
      const url = personId
        ? `${this.baseUrl}/persons/${personId}?api_token=${this.apiToken}`
        : `${this.baseUrl}/persons?api_token=${this.apiToken}`;

      const payload = {
        email: contact.email,
        name: contact.name || contact.email,
        phone: contact.phone || undefined,
      };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.warn(
          `[Pipedrive] upsertContact failed: ${response.status} - ${err}`,
          { merchantId, email: contact.email }
        );
        return;
      }

      this.logger.debug(`[Pipedrive] Contact upserted: ${contact.email}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Pipedrive] upsertContact error: ${errorMsg}`, {
        merchantId,
        email: contact.email,
      });
    }
  }

  async createDeal(merchantId: string, deal: CrmDeal): Promise<void> {
    try {
      // Step 1: search person by email
      const searchResponse = await fetch(
        `${this.baseUrl}/persons/search?term=${encodeURIComponent(deal.contactEmail)}&fields=email&api_token=${this.apiToken}`,
        { method: "GET" }
      );

      if (!searchResponse.ok) {
        this.logger.warn(
          `[Pipedrive] Person search failed: ${searchResponse.status}`,
          { merchantId, contactEmail: deal.contactEmail }
        );
        return;
      }

      const searchData = (await searchResponse.json()) as any;
      const personId = searchData.data?.items?.[0]?.item?.id;

      if (!personId) {
        this.logger.debug(
          `[Pipedrive] Person not found for email: ${deal.contactEmail}`
        );
        return;
      }

      // Step 2: create deal
      const dealResponse = await fetch(
        `${this.baseUrl}/deals?api_token=${this.apiToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: deal.title,
            person_id: personId,
            value: deal.valueCents / 100,
            currency: "BRL",
            stage_id: deal.stage || 1,
          }),
        }
      );

      if (!dealResponse.ok) {
        const err = await dealResponse.text();
        this.logger.warn(`[Pipedrive] createDeal failed: ${dealResponse.status} - ${err}`, {
          merchantId,
          dealTitle: deal.title,
        });
        return;
      }

      this.logger.debug(`[Pipedrive] Deal created: ${deal.title} (${deal.valueCents / 100} BRL)`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Pipedrive] createDeal error: ${errorMsg}`, {
        merchantId,
        dealTitle: deal.title,
      });
    }
  }
}
