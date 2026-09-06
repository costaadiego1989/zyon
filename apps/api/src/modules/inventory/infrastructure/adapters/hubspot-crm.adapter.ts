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

  async validateCredentials(): Promise<boolean> {
    try {
      // Minimal authenticated read: list 1 contact. 200 => token valid.
      const res = await fetch(`${this.baseUrl}/crm/v3/objects/contacts?limit=1`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async upsertContact(merchantId: string, contact: CrmContact): Promise<void> {
    try {
      // Try to update by email first (idProperty=email)
      const patchRes = await fetch(
        `${this.baseUrl}/crm/v3/objects/contacts/${encodeURIComponent(contact.email)}?idProperty=email`,
        {
          method: "PATCH",
          signal: AbortSignal.timeout(10000),
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
          signal: AbortSignal.timeout(10000),
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
          throw new Error(`inventory_crm_http_${createRes.status}`);
        }
        return;
      }

      if (!patchRes.ok) {
        throw new Error(`inventory_crm_http_${patchRes.status}`);
      }
    } catch {
      throw new Error("inventory_crm_provider_failed");
    }
  }

  async createDeal(merchantId: string, deal: CrmDeal): Promise<void> {
    try {
      // Look up the contact id first so the deal can be created with the
      // association inline (one call instead of POST deal + PUT association).
      let contactId: string | undefined;
      const contactLookup = await fetch(
        `${this.baseUrl}/crm/v3/objects/contacts/${encodeURIComponent(deal.contactEmail)}?idProperty=email`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );
      if (contactLookup.ok) {
        contactId = ((await contactLookup.json()) as { id?: string }).id;
      }

      // Open lead deals land in the first default-pipeline stage; sales are won.
      const dealstage = deal.stage || (deal.open ? "appointmentscheduled" : "closedwon");
      const body: Record<string, unknown> = {
        properties: {
          dealname: deal.title,
          dealstage,
          amount: String((deal.valueCents / 100).toFixed(2)),
          pipeline: "default",
        },
      };
      // associationTypeId 3 = deal → contact (HUBSPOT_DEFINED)
      if (contactId) {
        body.associations = [
          {
            to: { id: contactId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
          },
        ];
      }

      const dealRes = await fetch(`${this.baseUrl}/crm/v3/objects/deals`, {
        method: "POST",
          signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!dealRes.ok) {
        throw new Error(`inventory_crm_http_${dealRes.status}`);
      }

      this.logger.debug(`[HubSpot] Deal created: ${deal.title}`);
    } catch {
      throw new Error("inventory_crm_provider_failed");
    }
  }
}
