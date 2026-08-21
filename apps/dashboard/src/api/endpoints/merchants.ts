import { dashboardJson } from "../http/client.js";
import type { MerchantProfile, MerchantRules, MerchantTheme } from "../types.js";
import type { SeoSettings, GtmSettings, GenerateSeoSuggestionsRequest, GenerateSeoSuggestionsResponse } from "@zyon/shared-types";

export interface SeoGtmConfig {
  seo: SeoSettings;
  gtm: GtmSettings;
  lastUpdatedAt: string | null;
}

export interface UpdateSeoInput {
  seo?: Partial<SeoSettings>;
  gtm?: Partial<GtmSettings>;
}

export interface UpdateSeoOutput {
  seo: SeoSettings;
  gtm: GtmSettings;
  updatedAt: string;
}

export interface DomainEntry {
  id: string;
  domain: string;
  verified: boolean;
  verified_at?: string;
  cname_target: string;
}

export interface RegisterDomainOutput {
  domain_id: string;
  domain: string;
  cname_target: string;
  instructions: string;
}

export interface VerifyDomainOutput {
  domain: string;
  verified: boolean;
  verified_at?: string;
}

export function merchantEndpoints(base: string, f: typeof fetch) {
  return {
    merchantProfile(): Promise<MerchantProfile> {
      return dashboardJson<MerchantProfile>(base, "/merchants/me", { method: "GET" }, f);
    },

    getMerchantRules(): Promise<MerchantRules> {
      return dashboardJson(base, "/merchants/me/rules", { method: "GET" }, f);
    },

    putMerchantRules(patch: Partial<MerchantRules>): Promise<MerchantRules> {
      return dashboardJson(base, "/merchants/me/rules", { method: "PUT", jsonBody: patch }, f);
    },

    getMerchantTheme(): Promise<MerchantTheme> {
      return dashboardJson(base, "/merchants/me/theme", { method: "GET" }, f);
    },

    putMerchantTheme(theme: MerchantTheme): Promise<MerchantTheme> {
      return dashboardJson(base, "/merchants/me/theme", { method: "PUT", jsonBody: theme }, f);
    },

    uploadLogo(logoBase64: string): Promise<{ logoUrl: string }> {
      return dashboardJson(base, "/merchants/me/logo", { method: "POST", jsonBody: { logo: logoBase64 } }, f);
    },

    putStoreCategory(storeCategory: string): Promise<{ storeCategory: string }> {
      return dashboardJson(base, "/merchants/me/store-category", { method: "PUT", jsonBody: { storeCategory } }, f);
    },

    getStoreSettings(): Promise<Record<string, unknown>> {
      return dashboardJson(base, "/merchants/me/store-settings", { method: "GET" }, f);
    },

    putStoreSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
      return dashboardJson(base, "/merchants/me/store-settings", { method: "PUT", jsonBody: settings }, f);
    },

    putStoreName(name: string): Promise<{ name: string }> {
      return dashboardJson(base, "/merchants/me/name", { method: "PUT", jsonBody: { name } }, f);
    },

    generatePolicy(type: string, company?: Record<string, unknown>): Promise<{ policy: string }> {
      return dashboardJson(base, "/merchants/me/generate-policy", { method: "POST", jsonBody: { type, company } }, f);
    },

    getSeoSettings(): Promise<SeoGtmConfig> {
      return dashboardJson(base, "/merchants/me/store-settings/seo", { method: "GET" }, f);
    },

    putSeoSettings(body: UpdateSeoInput): Promise<UpdateSeoOutput> {
      return dashboardJson(base, "/merchants/me/store-settings/seo", { method: "PUT", jsonBody: body }, f);
    },

    generateSeoSuggestions(body: GenerateSeoSuggestionsRequest): Promise<GenerateSeoSuggestionsResponse> {
      return dashboardJson(base, "/merchants/me/store-settings/seo/generate", { method: "POST", jsonBody: body }, f);
    },

    deleteStorageObject(url: string): Promise<{ deleted: boolean }> {
      return dashboardJson(base, `/storage/object?url=${encodeURIComponent(url)}`, { method: "DELETE" }, f);
    },

    getCrossSellConfig(): Promise<any> {
      return dashboardJson(base, "/merchants/me/cross-sell-config", { method: "GET" }, f);
    },

    putCrossSellConfig(config: any): Promise<any> {
      return dashboardJson(base, "/merchants/me/cross-sell-config", { method: "PUT", jsonBody: config }, f);
    },

    listDomains(): Promise<DomainEntry[]> {
      return dashboardJson(base, "/merchants/me/domains", { method: "GET" }, f);
    },

    addDomain(domain: string): Promise<RegisterDomainOutput> {
      return dashboardJson(base, "/merchants/me/domains", { method: "POST", jsonBody: { domain } }, f);
    },

    verifyDomain(domainId: string): Promise<VerifyDomainOutput> {
      return dashboardJson(base, `/merchants/me/domains/${domainId}/verify`, { method: "POST", jsonBody: {} }, f);
    },

    removeDomain(domainId: string): Promise<{ success: boolean }> {
      return dashboardJson(base, `/merchants/me/domains/${domainId}`, { method: "DELETE" }, f);
    },

    listTeam(merchantId: string): Promise<{ members: Array<{ id: string; userId: string; email: string; role: "OWNER" | "ADMIN" | "STAFF"; joinedAt: string }>; invites: Array<{ id: string; email: string; role: "OWNER" | "ADMIN" | "STAFF"; status: "PENDING" | "ACCEPTED" | "EXPIRED"; createdAt: string; expiresAt: string }> }> {
      return dashboardJson(base, `/merchants/${merchantId}/team`, { method: "GET" }, f);
    },

    inviteTeamMember(merchantId: string, payload: { name: string; email: string; phone?: string; role: "OWNER" | "ADMIN" | "STAFF" }): Promise<{ id: string }> {
      return dashboardJson(base, `/merchants/${merchantId}/team/invite`, { method: "POST", jsonBody: payload }, f);
    },

    updateTeamMemberRole(merchantId: string, userId: string, role: "OWNER" | "ADMIN" | "STAFF"): Promise<{ ok: true }> {
      return dashboardJson(base, `/merchants/${merchantId}/team/${userId}/role`, { method: "PUT", jsonBody: { role } }, f);
    },

    removeTeamMember(merchantId: string, userId: string): Promise<{ ok: true }> {
      return dashboardJson(base, `/merchants/${merchantId}/team/${userId}`, { method: "DELETE" }, f);
    },

    // ─── WhatsApp Seller ───────────────────────────────────────────────────

    getWhatsAppConfig(merchantId: string): Promise<any> {
      return dashboardJson(base, `/merchants/${merchantId}/whatsapp/connection`, { method: "GET" }, f);
    },

    connectWhatsApp(merchantId: string, payload: { provider: string; phoneNumber: string }): Promise<any> {
      return dashboardJson(base, `/merchants/${merchantId}/whatsapp/twilio/connect`, { method: "POST", jsonBody: payload }, f);
    },

    verifyWhatsApp(merchantId: string, payload: { code: string }): Promise<any> {
      return dashboardJson(base, `/merchants/${merchantId}/whatsapp/twilio/verify`, { method: "POST", jsonBody: payload }, f);
    },

    disconnectWhatsApp(merchantId: string): Promise<any> {
      return dashboardJson(base, `/merchants/${merchantId}/whatsapp/disconnect`, { method: "POST" }, f);
    },

    testWhatsApp(merchantId: string): Promise<any> {
      return dashboardJson(base, `/merchants/${merchantId}/whatsapp/test`, { method: "POST" }, f);
    },

    toggleWhatsApp(merchantId: string, enabled: boolean): Promise<any> {
      return dashboardJson(base, `/merchants/${merchantId}/whatsapp/toggle`, { method: "POST", jsonBody: { enabled } }, f);
    },
  };
}
