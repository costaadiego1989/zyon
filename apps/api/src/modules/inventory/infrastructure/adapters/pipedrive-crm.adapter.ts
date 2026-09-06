import { Injectable, Logger } from "@nestjs/common";
import type { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";

/**
 * Pipedrive CRM adapter using API v2.
 * Auth: api_token query param (from Settings → Personal Preferences → API).
 * Docs: https://developers.pipedrive.com/docs/api/v2/Persons
 *
 * v2 changes from v1:
 * - email field: emails: [{ value, primary, label }]
 * - phone field: phones: [{ value, primary, label }]
 * - Base: /api/v2/persons (not /v1/)
 */
@Injectable()
export class PipedriveCrmAdapter implements CrmProviderPort {
  private readonly logger = new Logger(PipedriveCrmAdapter.name);
  private readonly baseUrl = "https://api.pipedrive.com";

  constructor(private readonly apiToken: string) {}

  private url(path: string): string {
    const sep = path.includes("?") ? "&" : "?";
    return `${this.baseUrl}${path}${sep}api_token=${this.apiToken}`;
  }

  async validateCredentials(): Promise<boolean> {
    try {
      // /users/me is the canonical token check for Pipedrive api_token auth.
      const res = await fetch(this.url("/api/v1/users/me"), {
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async upsertContact(merchantId: string, contact: CrmContact): Promise<void> {
    try {
      // Search person by email (v2 endpoint)
      const searchRes = await fetch(
        this.url(`/api/v2/persons/search?term=${encodeURIComponent(contact.email)}&fields=email&limit=1`), { signal: AbortSignal.timeout(10000) },
      );

      let personId: number | null = null;
      if (!searchRes.ok) throw new Error(`inventory_crm_http_${searchRes.status}`);
      if (searchRes.ok) {
        const searchData = (await searchRes.json()) as any;
        personId = searchData.data?.items?.[0]?.item?.id ?? null;
      }

      // Build payload (v2 format: emails/phones as arrays)
      const payload: Record<string, unknown> = {
        name: contact.name || contact.email,
        emails: [{ value: contact.email, primary: true, label: "work" }],
      };
      if (contact.phone) {
        payload.phones = [{ value: contact.phone, primary: true, label: "mobile" }];
      }

      if (personId) {
        // Update existing
        const updateRes = await fetch(this.url(`/api/v2/persons/${personId}`), {
          method: "PATCH",
          signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!updateRes.ok) {
          throw new Error(`inventory_crm_http_${updateRes.status}`);
        }
      } else {
        // Create new
        const createRes = await fetch(this.url("/api/v2/persons"), {
          method: "POST",
          signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!createRes.ok) {
          throw new Error(`inventory_crm_http_${createRes.status}`);
        }
      }
    } catch {
      throw new Error("inventory_crm_provider_failed");
    }
  }

  async createDeal(merchantId: string, deal: CrmDeal): Promise<void> {
    try {
      // Find person by email
      const searchRes = await fetch(
        this.url(`/api/v2/persons/search?term=${encodeURIComponent(deal.contactEmail)}&fields=email&limit=1`), { signal: AbortSignal.timeout(10000) },
      );

      let personId: number | null = null;
      if (!searchRes.ok) throw new Error(`inventory_crm_http_${searchRes.status}`);
      if (searchRes.ok) {
        const searchData = (await searchRes.json()) as any;
        personId = searchData.data?.items?.[0]?.item?.id ?? null;
      }

      // Create deal (v2 — POST /api/v2/deals: value/currency/status/person_id)
      const dealPayload: Record<string, unknown> = {
        title: deal.title,
        value: deal.valueCents / 100,
        currency: "BRL",
        status: deal.open ? "open" : "won",
      };
      if (personId) dealPayload.person_id = personId;

      const dealRes = await fetch(this.url("/api/v2/deals"), {
        method: "POST",
          signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dealPayload),
      });

      if (!dealRes.ok) {
        throw new Error(`inventory_crm_http_${dealRes.status}`);
      }

      this.logger.debug(`[Pipedrive] Deal created: ${deal.title}`);
    } catch {
      throw new Error("inventory_crm_provider_failed");
    }
  }
}
