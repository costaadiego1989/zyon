import { dashboardJson } from "../http/client.js";
import type { Review, NpsItem, PostSaleStats, PostSaleTemplate } from "../../pages/post-sale/usePostSalePage.js";

export function postSaleEndpoints(base: string, f: typeof fetch) {
  return {
    getPostSaleStats(): Promise<PostSaleStats> {
      return dashboardJson<PostSaleStats>(base, "/dashboard/post-sale/stats", { method: "GET" }, f);
    },

    getPostSaleReviews(page = 1, status?: string): Promise<{ items: Review[]; total: number }> {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      return dashboardJson<{ items: Review[]; total: number }>(
        base,
        `/dashboard/post-sale/reviews?${params}`,
        { method: "GET" },
        f
      );
    },

    getPostSaleNps(page = 1): Promise<{ items: NpsItem[]; total: number }> {
      return dashboardJson<{ items: NpsItem[]; total: number }>(
        base,
        `/dashboard/post-sale/nps?page=${page}`,
        { method: "GET" },
        f
      );
    },

    moderateReview(reviewId: string, status: "approved" | "rejected"): Promise<{ success: boolean }> {
      return dashboardJson<{ success: boolean }>(
        base,
        `/dashboard/post-sale/reviews/${reviewId}/moderate`,
        { method: "PATCH", jsonBody: { status } },
        f
      );
    },

    listTemplates(): Promise<{ templates: PostSaleTemplate[] }> {
      return dashboardJson<{ templates: PostSaleTemplate[] }>(
        base,
        "/dashboard/post-sale/templates",
        { method: "GET" },
        f
      );
    },

    saveTemplate(type: string, channel: string, data: { name: string; body: string; subject?: string; metaCategory?: string; metaLanguage?: string; metaTemplateBody?: string; metaVariableMap?: Record<string, string> }): Promise<{ template: PostSaleTemplate }> {
      return dashboardJson<{ template: PostSaleTemplate }>(
        base,
        `/dashboard/post-sale/templates/${type}/${channel}`,
        { method: "PUT", jsonBody: data },
        f
      );
    },

    generateTemplate(data: { type: string; channel: string; tone?: string; storeName?: string }): Promise<GeneratePostSaleTemplateResult> {
      return dashboardJson<GeneratePostSaleTemplateResult>(
        base,
        "/dashboard/post-sale/templates/generate",
        { method: "POST", jsonBody: data },
        f
      );
    },

    submitMetaTemplate(type: string, channel: string): Promise<{ template: PostSaleTemplate; submission: { contentSid: string; status: string; rejectionReason?: string } }> {
      return dashboardJson(
        base,
        `/dashboard/post-sale/templates/${type}/${channel}/submit-meta`,
        { method: "POST" },
        f
      );
    },

    getMetaTemplateStatus(type: string, channel: string): Promise<{ status: string; contentSid: string | null; rejectionReason?: string }> {
      return dashboardJson(
        base,
        `/dashboard/post-sale/templates/${type}/${channel}/meta-status`,
        { method: "GET" },
        f
      );
    },

    getTemplatePackageStatus(): Promise<{ total: number; approved: number; submitted: number; rejected: number; draft: number; perType: Array<{ type: string; status: string; rejectionReason?: string | null }> }> {
      return dashboardJson(
        base,
        "/dashboard/post-sale/templates/package-status",
        { method: "GET" },
        f
      );
    },
  };
}

export interface GeneratePostSaleTemplateResult {
  name: string;
  body: string;
  subject?: string;
  meta: {
    metaBody: string;
    variableMap: Record<string, string>;
    sampleVariables: Record<string, string>;
    category: "UTILITY" | "MARKETING";
    language: string;
  };
}
