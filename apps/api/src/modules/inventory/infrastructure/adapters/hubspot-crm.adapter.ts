import type { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";
import { crmRequest, crmJson } from "./crm-http.js";

/** HubSpot CRM v3: contacts and deals, with the account's actual pipeline stages. */
export class HubSpotCrmAdapter implements CrmProviderPort {
  private readonly baseUrl = "https://api.hubapi.com";
  private readonly headers: Record<string, string>;
  constructor(accessToken: string) { this.headers = { Authorization: `Bearer ${accessToken}` }; }
  private request(path: string, method = "GET", body?: unknown, accepted: number[] = []) {
    return crmRequest(this.baseUrl + path, this.headers, method, body, accepted);
  }
  async validateCredentials(): Promise<boolean> {
    try {
      await Promise.all([this.request("/crm/v3/objects/contacts?limit=1"),
        this.request("/crm/v3/objects/deals?limit=1"), this.request("/crm/v3/pipelines/deals")]);
      return true;
    } catch { return false; }
  }
  async upsertContact(_merchantId: string, contact: CrmContact): Promise<void> {
    const names = contact.name?.trim().split(/\s+/);
    const properties = { ...(names?.[0] ? { firstname: names[0] } : {}),
      ...(names && names.length > 1 ? { lastname: names.slice(1).join(" ") } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}) };
    const response = await this.request(`/crm/v3/objects/contacts/${encodeURIComponent(contact.email)}?idProperty=email`,
      "PATCH", { properties }, [404]);
    if (response.status === 404) {
      await this.request("/crm/v3/objects/contacts", "POST", { properties: { email: contact.email, ...properties } });
    }
  }
  async createDeal(_merchantId: string, deal: CrmDeal): Promise<void> {
    // A confirmed retry finds the same order rather than adding another won deal.
    if (deal.metadata?.order_id) {
      const result = await crmJson<{ results?: Array<{ id: string }> }>(await this.request("/crm/v3/objects/deals/search", "POST", {
        filterGroups: [{ filters: [{ propertyName: "dealname", operator: "EQ", value: deal.title }] }], limit: 1,
      }));
      if (result.results?.length) return;
    }
    const contact = await crmJson<{ id?: string }>(await this.request(
      `/crm/v3/objects/contacts/${encodeURIComponent(deal.contactEmail)}?idProperty=email`));
    if (!contact.id) throw new Error("inventory_crm_provider_failed");
    const pipelines = await crmJson<{ results?: Array<{ id: string; stages: Array<{
      id: string; displayOrder?: number; metadata?: { isClosed?: string; probability?: string }
    }> }> }>(await this.request("/crm/v3/pipelines/deals"));
    const pipeline = pipelines.results?.find(p => p.id === "default") ?? pipelines.results?.[0];
    const stages = [...(pipeline?.stages ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    const stage = deal.open ? stages.find(s => s.metadata?.isClosed === "false") :
      stages.find(s => s.metadata?.isClosed === "true" && Number(s.metadata?.probability) > 0);
    if (!pipeline || !stage) throw new Error("inventory_crm_provider_failed");
    await this.request("/crm/v3/objects/deals", "POST", {
      properties: { dealname: deal.title, dealstage: stage.id, pipeline: pipeline.id, amount: (deal.valueCents / 100).toFixed(2) },
      associations: [{ to: { id: contact.id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
    });
  }
}
