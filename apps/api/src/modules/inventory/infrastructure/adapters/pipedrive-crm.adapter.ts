import type { CrmProviderPort, CrmContact, CrmDeal } from "../../domain/ports/crm-provider.port.js";
import { crmRequest, crmJson } from "./crm-http.js";

/** Pipedrive v2 uses an exact email match and preserves unspecified contact fields. */
export class PipedriveCrmAdapter implements CrmProviderPort {
  private upsertedContact?: { email: string; id: number };
  constructor(private readonly apiToken: string) {}
  private async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    return crmJson<T>(await crmRequest(`https://api.pipedrive.com${path}${sep}api_token=${encodeURIComponent(this.apiToken)}`,
      {}, method, body));
  }
  async validateCredentials(): Promise<boolean> {
    try { await this.request("/api/v1/users/me"); return true; } catch { return false; }
  }
  private async personId(email: string): Promise<number | undefined> {
    const result = await this.request<{ data?: { items?: Array<{ item: { id: number } }> } }>(
      `/api/v2/persons/search?term=${encodeURIComponent(email)}&fields=email&exact_match=true&limit=1`);
    return result.data?.items?.[0]?.item?.id;
  }
  async upsertContact(_merchantId: string, contact: CrmContact): Promise<void> {
    this.upsertedContact = undefined;
    const id = await this.personId(contact.email);
    const payload = { ...(contact.name ? { name: contact.name } : !id ? { name: contact.email } : {}),
      ...(!id ? { emails: [{ value: contact.email, primary: true, label: "work" }] } : {}),
      ...(contact.phone ? { phones: [{ value: contact.phone, primary: true, label: "mobile" }] } : {}) };
    const result = await this.request<{ data?: { id: number } }>(id ? `/api/v2/persons/${id}` : "/api/v2/persons", id ? "PATCH" : "POST", payload);
    const personId = result.data?.id ?? id;
    if (!Number.isSafeInteger(personId) || !personId || personId <= 0) throw new Error("inventory_crm_provider_failed");
    // New contacts can take time to enter the provider's search index.
    this.upsertedContact = { email: contact.email.trim().toLowerCase(), id: personId };
  }
  async createDeal(_merchantId: string, deal: CrmDeal): Promise<void> {
    if (deal.metadata?.order_id) {
      const result = await this.request<{ data?: { items?: unknown[] } }>(
        `/api/v2/deals/search?term=${encodeURIComponent(deal.title)}&fields=title&exact_match=true&limit=1`);
      if (result.data?.items?.length) return;
    }
    const personId = this.upsertedContact?.email === deal.contactEmail.trim().toLowerCase() ?
      this.upsertedContact.id : await this.personId(deal.contactEmail);
    if (!personId) throw new Error("inventory_crm_provider_failed");
    await this.request("/api/v2/deals", "POST", { title: deal.title, value: deal.valueCents / 100,
      currency: "BRL", status: deal.open ? "open" : "won", person_id: personId });
  }
}
