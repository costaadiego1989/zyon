import { dashboardJson } from "../http/client.js";
import type { MerchantProfile, MerchantRules, MerchantTheme } from "../types.js";

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
  };
}
