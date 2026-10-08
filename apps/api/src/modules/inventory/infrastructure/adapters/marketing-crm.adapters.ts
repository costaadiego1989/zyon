import { createHash } from "node:crypto";
import type { CrmContact, CrmProviderPort } from "../../domain/ports/crm-provider.port.js";
import { crmJson } from "./crm-http.js";

/** No external URLs, credentials, or response bodies are exposed through errors. */
async function request(url: string, headers: Record<string, string>, method = "GET", body?: unknown): Promise<Response> {
  try {
    const response = await fetch(url, {
      method, headers: { "Content-Type": "application/json", ...headers }, redirect: "error",
      signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error("provider_http_failure");
    return response;
  } catch { throw new Error("inventory_crm_provider_failed"); }
}

function nameFields(name?: string): { firstName?: string; lastName?: string } {
  if (!name?.trim()) return {};
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName, ...(rest.length ? { lastName: rest.join(" ") } : {}) };
}

// https://mailchimp.com/developer/marketing/api/lists/members/upsert-member
export class MailchimpCrmAdapter implements CrmProviderPort {
  readonly category = "marketing" as const;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  constructor(token: string, private readonly audienceId: string) {
    const dc = /-(us\d+)$/.exec(token)?.[1];
    if (!dc) throw new Error("crm_mailchimp_key_invalid");
    this.baseUrl = `https://${dc}.api.mailchimp.com/3.0`;
    this.headers = { Authorization: `Bearer ${token}` };
  }
  async validateCredentials(): Promise<boolean> {
    try { await request(`${this.baseUrl}/lists/${this.audienceId}?fields=id`, this.headers); return true; }
    catch { return false; }
  }
  async upsertContact(_merchantId: string, contact: CrmContact): Promise<void> {
    const email = contact.email.trim().toLowerCase();
    const hash = createHash("md5").update(email).digest("hex");
    const path = `${this.baseUrl}/lists/${this.audienceId}/members/${hash}`;
    const names = nameFields(contact.name);
    await request(`${path}?skip_merge_validation=true`, this.headers, "PUT", {
      email_address: email, status_if_new: "subscribed",
      // Omitting status preserves an existing unsubscribe/cleaned/pending state.
      merge_fields: { ...(names.firstName ? { FNAME: names.firstName } : {}), ...(names.lastName ? { LNAME: names.lastName } : {}) },
    });
    const customer = contact.tags?.includes("customer");
    await request(`${path}/tags`, this.headers, "POST", {
      tags: [{ name: "zyon_lead", status: customer ? "inactive" : "active" },
        { name: "zyon_customer", status: customer ? "active" : "inactive" }],
      is_syncing: true,
    });
  }
}

// https://developers.activecampaign.com/reference/sync-a-contacts-data
export class ActiveCampaignCrmAdapter implements CrmProviderPort {
  readonly category = "marketing" as const;
  private readonly headers: Record<string, string>;
  constructor(token: string, private readonly apiUrl: string) { this.headers = { "Api-Token": token }; }
  async validateCredentials(): Promise<boolean> {
    try { await request(`${this.apiUrl}/api/3/contacts?limit=1`, this.headers); return true; }
    catch { return false; }
  }
  async upsertContact(_merchantId: string, contact: CrmContact): Promise<void> {
    const response = await request(`${this.apiUrl}/api/3/contact/sync`, this.headers, "POST", {
      contact: { email: contact.email.trim().toLowerCase(), ...nameFields(contact.name), ...(contact.phone ? { phone: contact.phone } : {}) },
    });
    const data = await crmJson<{ contact?: { id?: string } }>(response);
    if (!data.contact?.id) throw new Error("inventory_crm_provider_failed");
    // List subscriptions and automation enrollment remain under merchant control.
  }
}

// https://developers.klaviyo.com/en/reference/create_or_update_profile
export class KlaviyoCrmAdapter implements CrmProviderPort {
  readonly category = "marketing" as const;
  private readonly headers: Record<string, string>;
  private readonly baseUrl = "https://a.klaviyo.com/api";
  constructor(token: string) {
    this.headers = { Authorization: `Klaviyo-API-Key ${token}`, revision: "2026-07-15", accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" };
  }
  async validateCredentials(): Promise<boolean> {
    try { await request(`${this.baseUrl}/profiles/?page[size]=1`, this.headers); return true; }
    catch { return false; }
  }
  async upsertContact(_merchantId: string, contact: CrmContact): Promise<void> {
    const names = nameFields(contact.name);
    const response = await request(`${this.baseUrl}/profile-import/`, this.headers, "POST", {
      data: { type: "profile", attributes: {
        email: contact.email.trim().toLowerCase(),
        ...(names.firstName ? { first_name: names.firstName } : {}), ...(names.lastName ? { last_name: names.lastName } : {}),
        ...(contact.phone && /^\+[1-9]\d{7,14}$/.test(contact.phone) ? { phone_number: contact.phone } : {}),
        properties: { zyon_source: "Zyon", zyon_stage: contact.tags?.includes("customer") ? "customer" : "lead" },
      } },
    });
    const data = await crmJson<{ data?: { id?: string } }>(response);
    if (!data.data?.id) throw new Error("inventory_crm_provider_failed");
    // Profile import does not subscribe email or SMS or enroll a flow.
  }
}
