import { BadRequestException } from "@nestjs/common";

export const CRM_PROVIDERS = ["hubspot", "pipedrive", "rdstation", "mailchimp", "activecampaign", "klaviyo"] as const;

/** Only public settings are accepted. Credentials must stay in the encrypted fields. */
export function normalizeCrmConfig(provider: string, input?: Record<string, unknown>): Record<string, string> {
  if (!CRM_PROVIDERS.includes(provider as typeof CRM_PROVIDERS[number])) {
    throw new BadRequestException("crm_provider_unsupported");
  }
  if (provider === "mailchimp") {
    const audienceId = typeof input?.audienceId === "string" ? input.audienceId.trim() : "";
    if (!/^[a-zA-Z0-9]{1,64}$/.test(audienceId)) throw new BadRequestException("crm_audience_id_required");
    return { audienceId };
  }
  if (provider === "activecampaign") {
    const value = typeof input?.apiUrl === "string" ? input.apiUrl.trim() : "";
    let url: URL;
    try { url = new URL(value); } catch { throw new BadRequestException("crm_api_url_invalid"); }
    // Provider-owned hosts only; reject IPs, ports, credentials, and arbitrary redirects.
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
        !/^[a-z0-9][a-z0-9-]*\.(?:api-(?:us|eu|au)\d+\.com|activehosted\.com)$/.test(url.hostname) ||
        !["/", "/api/3", "/api/3/"].includes(url.pathname)) {
      throw new BadRequestException("crm_api_url_invalid");
    }
    return { apiUrl: url.origin };
  }
  return {};
}
