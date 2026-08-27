import type { Review, NpsItem, PostSaleStats, PostSaleTemplate } from "../../pages/post-sale/usePostSalePage.js";

export function postSaleEndpoints(base: string, f: typeof fetch) {
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("aacp_token")}`,
  });

  return {
    getPostSaleStats(): Promise<PostSaleStats> {
      return f(`${base}/dashboard/post-sale/stats`, {
        headers: headers(),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },

    getPostSaleReviews(page = 1, status?: string): Promise<{ items: Review[]; total: number }> {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      return f(`${base}/dashboard/post-sale/reviews?${params}`, {
        headers: headers(),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },

    getPostSaleNps(page = 1): Promise<{ items: NpsItem[]; total: number }> {
      return f(`${base}/dashboard/post-sale/nps?page=${page}`, {
        headers: headers(),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },

    moderateReview(reviewId: string, status: "approved" | "rejected"): Promise<{ success: boolean }> {
      return f(`${base}/dashboard/post-sale/reviews/${reviewId}/moderate`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status }),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },

    listTemplates(): Promise<{ templates: PostSaleTemplate[] }> {
      return f(`${base}/dashboard/post-sale/templates`, {
        headers: headers(),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },

    saveTemplate(type: string, channel: string, data: { name: string; body: string; subject?: string }): Promise<{ template: PostSaleTemplate }> {
      return f(`${base}/dashboard/post-sale/templates/${type}/${channel}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },

    generateTemplate(data: { type: string; channel: string; tone?: string; storeName?: string }): Promise<{ name: string; body: string; subject?: string }> {
      return f(`${base}/dashboard/post-sale/templates/generate`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },
  };
}
