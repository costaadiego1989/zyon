import type { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";
import { crmRequest, crmJson } from "./crm-http.js";

/** RD Station CRM v1, not RD Marketing. Nested contact/deal bodies follow its OpenAPI. */
export class RdStationCrmAdapter implements CrmProviderPort {
  private upsertedContact?: { email: string; contact: { _id: string; name?: string } };
  constructor(private readonly token: string) {}
  private async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    return crmJson<T>(await crmRequest(`https://crm.rdstation.com/api/v1${path}${sep}token=${encodeURIComponent(this.token)}`,
      {}, method, body));
  }
  async validateCredentials(): Promise<boolean> {
    try { await this.request("/deal_stages"); return true; } catch { return false; }
  }
  private async findContact(email: string) {
    const result = await this.request<{ contacts?: Array<{ _id: string; name?: string; emails?: Array<{ email: string }> }> }>(
      `/contacts?email=${encodeURIComponent(email)}&limit=200`);
    return result.contacts?.find(c => c.emails?.some(e => e.email.toLowerCase() === email.toLowerCase()));
  }
  async upsertContact(_merchantId: string, contact: CrmContact): Promise<void> {
    this.upsertedContact = undefined;
    const existing = await this.findContact(contact.email);
    const result = await this.request<{ _id?: string; name?: string }>(existing ? `/contacts/${encodeURIComponent(existing._id)}` : "/contacts", existing ? "PUT" : "POST", {
      contact: { ...(contact.name ? { name: contact.name } : !existing ? { name: contact.email } : {}),
        ...(!existing ? { emails: [{ email: contact.email }] } : {}),
        ...(contact.phone ? { phones: [{ phone: contact.phone, type: "cellphone" }] } : {}) },
    });
    const id = result._id ?? existing?._id;
    if (!id) throw new Error("inventory_crm_provider_failed");
    // A created contact can be absent from the provider's search index briefly.
    this.upsertedContact = { email: contact.email.trim().toLowerCase(),
      contact: { _id: id, name: result.name ?? contact.name ?? existing?.name } };
  }
  async createDeal(_merchantId: string, deal: CrmDeal): Promise<void> {
    let dealId: string | undefined;
    if (deal.metadata?.order_id) {
      const result = await this.request<{ deals?: Array<{ _id: string; name: string; win?: boolean | null }> }>(
        `/deals?name=${encodeURIComponent(deal.title)}&exact_name=true&limit=1`);
      const existing = result.deals?.find(d => d.name === deal.title);
      if (existing?.win === true) return;
      dealId = existing?._id;
    }
    if (!dealId) {
      const contact = this.upsertedContact?.email === deal.contactEmail.trim().toLowerCase() ?
        this.upsertedContact.contact : await this.findContact(deal.contactEmail);
      if (!contact) throw new Error("inventory_crm_provider_failed");
      const value = deal.valueCents / 100;
      const created = await this.request<{ _id?: string }>("/deals", "POST", {
        deal: { name: deal.title },
        ...(value > 0 ? { deal_products: [{ name: "Pedido Zyon", amount: 1, price: value, base_price: value, total: value, recurrence: "spare" }] } : {}),
      });
      dealId = created._id;
      if (!dealId) throw new Error("inventory_crm_provider_failed");
    }
    // Embedded contacts create a new record. Link the existing contact by ID.
    // Repeat this step for an open deal after a partially completed attempt.
    const contact = this.upsertedContact?.email === deal.contactEmail.trim().toLowerCase() ?
      this.upsertedContact.contact : await this.findContact(deal.contactEmail);
    if (!contact) throw new Error("inventory_crm_provider_failed");
    const current = await this.request<{ deal_ids?: string[] }>(`/contacts/${encodeURIComponent(contact._id)}`);
    if (!current.deal_ids?.includes(dealId)) {
      await this.request(`/contacts/${encodeURIComponent(contact._id)}`, "PUT", {
        contact: { deal_ids: [...new Set([...(current.deal_ids ?? []), dealId])] },
      });
    }
    // A new negotiation is open. false means LOST; only completed sales become won.
    if (!deal.open) await this.request(`/deals/${encodeURIComponent(dealId)}`, "PUT", { deal: { win: true } });
  }
}
