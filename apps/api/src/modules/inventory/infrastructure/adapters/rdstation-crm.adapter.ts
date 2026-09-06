import { Injectable, Logger } from "@nestjs/common";
import type { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";

/**
 * RD Station CRM adapter (CRM product, not Marketing).
 * Auth: token query param (generated in RD CRM → Settings → API Token).
 * Base: https://plugcrm.net/api/v1 (legacy URL) OR https://crm.rdstation.com/api/v1
 * Docs: https://developers.rdstation.com/reference/post_platform-contacts
 *
 * NOTE: RD Station has 2 products:
 * - RD Marketing (api.rd.services) — email marketing, landing pages
 * - RD CRM (crm.rdstation.com/api/v1) — contacts, deals, pipeline
 * This adapter uses the CRM product.
 */
@Injectable()
export class RdStationCrmAdapter implements CrmProviderPort {
  private readonly logger = new Logger(RdStationCrmAdapter.name);
  private readonly baseUrl = "https://crm.rdstation.com/api/v1";

  constructor(private readonly token: string) {}

  private url(path: string): string {
    const sep = path.includes("?") ? "&" : "?";
    return `${this.baseUrl}${path}${sep}token=${encodeURIComponent(this.token)}`;
  }

  async validateCredentials(): Promise<boolean> {
    try {
      // List deal pipelines (deal_stages) — small authenticated read.
      const res = await fetch(this.url("/deal_stages"), { signal: AbortSignal.timeout(8000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async upsertContact(merchantId: string, contact: CrmContact): Promise<void> {
    try {
      // RD CRM: POST /contacts — if email exists, it updates (native upsert by email)
      const payload: Record<string, unknown> = {
        name: contact.name || contact.email,
        email: contact.email,
      };
      if (contact.phone) payload.mobile_phone = contact.phone;
      if (contact.tags?.length) payload.tags = contact.tags;

      const response = await fetch(this.url("/contacts"), {
        method: "POST",
          signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`inventory_crm_http_${response.status}`);
      }

      this.logger.debug(`[RD Station] Contact upserted: ${contact.email}`);
    } catch {
      throw new Error("inventory_crm_provider_failed");
    }
  }

  async createDeal(merchantId: string, deal: CrmDeal): Promise<void> {
    try {
      // First find contact by email to get their ID
      const searchRes = await fetch(
        this.url(`/contacts?email=${encodeURIComponent(deal.contactEmail)}&limit=1`), { signal: AbortSignal.timeout(10000) },
      );

      let contactId: string | null = null;
      if (!searchRes.ok) throw new Error(`inventory_crm_http_${searchRes.status}`);
      if (searchRes.ok) {
        const data = (await searchRes.json()) as { contacts?: Array<{ _id: string }> };
        contactId = data.contacts?.[0]?._id ?? null;
      }

      // Create deal
      const dealPayload: Record<string, unknown> = {
        name: deal.title,
        amount_montly: deal.valueCents / 100, // RD uses amount_montly (their typo, not ours)
        amount_unique: deal.valueCents / 100,
        win: deal.open ? false : true,
      };
      if (contactId) {
        dealPayload.contacts = [{ _id: contactId }];
      }

      const dealRes = await fetch(this.url("/deals"), {
        method: "POST",
          signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dealPayload),
      });

      if (!dealRes.ok) {
        throw new Error(`inventory_crm_http_${dealRes.status}`);
      }

      this.logger.debug(`[RD Station] Deal created: ${deal.title}`);
    } catch {
      throw new Error("inventory_crm_provider_failed");
    }
  }
}
