import { Injectable, Logger } from "@nestjs/common";
import { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";

/**
 * HubSpot CRM adapter using API v3.
 * Fire-and-forget: errors logged, not thrown.
 */
@Injectable()
export class HubSpotCrmAdapter implements CrmProviderPort {
  private readonly logger = new Logger(HubSpotCrmAdapter.name);
  private readonly baseUrl = "https://api.hubapi.com";

  constructor(private readonly accessToken: string) {}

  async upsertContact(merchantId: string, contact: CrmContact): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            email: contact.email,
            firstname: contact.name || "",
            phone: contact.phone || "",
            hs_lead_status: "NEW",
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.warn(
          `[HubSpot] upsertContact failed: ${response.status} - ${err}`,
          { merchantId, email: contact.email }
        );
        return;
      }

      this.logger.debug(`[HubSpot] Contact upserted: ${contact.email}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[HubSpot] upsertContact error: ${errorMsg}`, {
        merchantId,
        email: contact.email,
      });
    }
  }

  async createDeal(merchantId: string, deal: CrmDeal): Promise<void> {
    try {
      // Step 1: search for contact by email
      const contactSearchResponse = await fetch(
        `${this.baseUrl}/crm/v3/objects/contacts/search`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "email",
                    operator: "EQ",
                    value: deal.contactEmail,
                  },
                ],
              },
            ],
            limit: 1,
          }),
        }
      );

      if (!contactSearchResponse.ok) {
        this.logger.warn(
          `[HubSpot] Contact search failed: ${contactSearchResponse.status}`,
          { merchantId, contactEmail: deal.contactEmail }
        );
        return;
      }

      const contactSearchData = (await contactSearchResponse.json()) as any;
      const contactId = contactSearchData.results?.[0]?.id;

      if (!contactId) {
        this.logger.debug(
          `[HubSpot] Contact not found for email: ${deal.contactEmail}`
        );
        return;
      }

      // Step 2: create deal
      const dealResponse = await fetch(`${this.baseUrl}/crm/v3/objects/deals`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            dealname: deal.title,
            dealstage: deal.stage || "negotiation",
            amount: String((deal.valueCents / 100).toFixed(2)),
          },
          associations: [
            {
              types: [{ associationCategory: "HUBSPOT_DEFINED", associationType: "contact_to_deal" }],
              id: contactId,
            },
          ],
        }),
      });

      if (!dealResponse.ok) {
        const err = await dealResponse.text();
        this.logger.warn(`[HubSpot] createDeal failed: ${dealResponse.status} - ${err}`, {
          merchantId,
          dealTitle: deal.title,
        });
        return;
      }

      this.logger.debug(`[HubSpot] Deal created: ${deal.title} (${deal.valueCents / 100} BRL)`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[HubSpot] createDeal error: ${errorMsg}`, {
        merchantId,
        dealTitle: deal.title,
      });
    }
  }
}
