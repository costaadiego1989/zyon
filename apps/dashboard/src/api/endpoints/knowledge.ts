import { dashboardJson } from "../http/client.js";

export interface MerchantPolicyResponse {
  returns?: string | null;
  shipping?: string | null;
  warranty?: string | null;
  payment?: string | null;
  general?: string | null;
}

export interface KnowledgeStatusResponse {
  total: number;
  products: number;
  policies: number;
  faq: number;
  config: number;
}

export interface ReindexResponse {
  reindexed: boolean;
  productsIndexed: number;
  faqIndexed: number;
  policyIndexed: number;
}

export function knowledgeEndpoints(base: string, f: typeof fetch) {
  return {
    getKnowledgePolicies(): Promise<MerchantPolicyResponse> {
      return dashboardJson(base, "/knowledge/policies", { method: "GET" }, f);
    },

    putKnowledgePolicies(data: MerchantPolicyResponse): Promise<MerchantPolicyResponse> {
      return dashboardJson(base, "/knowledge/policies", { method: "PUT", jsonBody: data }, f);
    },

    getKnowledgeStatus(): Promise<KnowledgeStatusResponse> {
      return dashboardJson(base, "/knowledge/status", { method: "GET" }, f);
    },

    postKnowledgeReindex(): Promise<ReindexResponse> {
      return dashboardJson(base, "/knowledge/reindex", { method: "POST" }, f);
    },
  };
}
