import { Injectable, Logger } from "@nestjs/common";
import type { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";

/**
 * HubSpot CRM adapter using API v3.
 * Auth: Private App Token (Bearer).
 * Docs: https://developers.hubspot.com/docs/api/crm/contacts
 *
 * upsertContact: PATCH by email (idProperty=email) — creates if not found, updates if found.
 * createDeal: POST /crm/v3/objects/deals + associate to contact via v4 associations.
 */
@Injectable()
export class HubSpotCrmAdapter implements CrmProviderPort {
  private readonly logger = new Logger(HubSpotCrmAdapter.name);
  private readonly baseUrl = "https://api.hubapi.com";

  constructor(private readonly accessToken: string) {}

  async upsertContact(merchantId: string, contact: CrmContact): Promise<void> {
    try {
      // Try to update by email first (idProperty=email)
      const patchRes = await fetch(
        `${this.baseUrl}/crm/v3/objects/contacts/${encodeURIComponent(contact.email)}?idProperty=email`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: {
              firstname: contact.name?.split(" ")[0] || "",
              lastname: contact.name?.split(" ").slice(1).join(" ") || "",
              phone: contact.phone || "",
            },
          }),
        },
      );

      if (patchRes.status === 404) {
        // Contact doesn't exist — create
        const createRes = await fetch(`${this.baseUrl}/crm/v3/objects/contacts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: {
              email: contact.email,
              firstname: contact.name?.split(" ")[0] || "",
              lastname: contact.name?.split(" ").slice(1).join(" ") || "",
              phone: contact.phone || "",
              lifecyclestage: "customer",
            },
          }),
        });

        if (!createRes.ok) {
          const err = await createRes.text();
          this.logger.warn(`[HubSpot] createContact failed: ${createRes.status} — ${err.slice(0, 200)}`);
        }
        return;
      }

      if (!patchRes.ok) {
        const err = await patchRes.text();
        this.logger.warn(`[HubSpot] upsertContact PATCH failed: ${patchRes.status} — ${err.slice(0, 200)}`);
      }
    } catch (err) {
      this.logger.warn(`[HubSpot] upsertContact error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createDeal(merchantId: string, deal: CrmDeal): Promise<void> {
    try {
      // Create deal
      const dealRes = await fetch(`${this.baseUrl}/crm/v3/objects/deals`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            dealname: deal.title,
            dealstage: deal.stage || "closedwon",
            amount: String((deal.valueCents / 100).toFixed(2)),
            pipeline: "default",
          },
        }),
      });

      if (!dealRes.ok) {
        const err = await dealRes.text();
        this.logger.warn(`[HubSpot] createDeal failed: ${dealRes.status} — ${err.slice(0, 200)}`);
        return;
      }

      const dealData = (await dealRes.json()) as { id: string };

      // Associate deal → contact (associationTypeId 3 = deal_to_contact)
      const contactLookup = await fetch(
        `${this.baseUrl}/crm/v3/objects/contacts/${encodeURIComponent(deal.contactEmail)}?idProperty=email`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );

      if (contactLookup.ok) {
        const contactData = (await contactLookup.json()) as { id: string };
        await fetch(
          `${this.baseUrl}/crm/v4/objects/deals/${dealData.id}/associations/contacts/${contactData.id}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }]),
          },
        );
      }

      this.logger.debug(`[HubSpot] Deal created: ${deal.title}`);
    } catch (err) {
      this.logger.warn(`[HubSpot] createDeal error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
