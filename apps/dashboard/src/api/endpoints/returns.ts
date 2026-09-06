import { dashboardJson } from "../http/client.js";

export type ReturnStatus = "REQUESTED" | "LABEL_GENERATED" | "SHIPPED" | "RECEIVED" | "INSPECTED_PASS" | "INSPECTED_FAIL" | "REFUND_PROCESSING" | "REFUND_COMPLETED" | "REJECTED" | "CANCELLED";
export type ReturnReason = "DEFECTIVE" | "WRONG_ITEM" | "NOT_AS_DESCRIBED" | "CHANGED_MIND" | "DAMAGED_IN_TRANSIT" | "OTHER";
export type ReturnItemCondition = "NEW" | "GOOD" | "DAMAGED" | "UNUSABLE";

export interface ReturnItem {
  id: string;
  variantId: string;
  productName: string;
  quantity: number;
  reason: ReturnReason;
}

export interface ReturnEntry {
  id: string;
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  status: ReturnStatus;
  reason: ReturnReason;
  items: ReturnItem[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  label?: { carrier: string; trackingNumber: string; labelUrl?: string };
  inspection?: { inspectedBy: string; itemCondition: ReturnItemCondition; verdict: string; notes?: string };
  refund?: { amountCents: number; status: string; processedAt?: string };
}

export interface ReturnListResponse {
  returns: ReturnEntry[];
  total: number;
}

export function returnsEndpoints(base: string, f: typeof fetch) {
  return {
    async listReturns(merchantId: string, params?: { status?: ReturnStatus; limit?: number; offset?: number }): Promise<ReturnListResponse> {
      const query = new URLSearchParams();
      if (params?.status) query.set("status", params.status);
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.offset) query.set("offset", String(params.offset));
      const qs = query.toString();
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns${qs ? `?${qs}` : ""}`, { method: "GET" }, f);
    },

    async generateReturnLabel(merchantId: string, returnId: string): Promise<void> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/label`, { method: "POST" }, f);
    },

    async markReturnReceived(merchantId: string, returnId: string): Promise<void> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/receive`, { method: "POST" }, f);
    },

    async inspectReturn(merchantId: string, returnId: string, data: { itemCondition: ReturnItemCondition; verdict: string; notes?: string }): Promise<void> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/inspect`, { method: "POST", jsonBody: data }, f);
    },

    async processRefund(merchantId: string, returnId: string): Promise<void> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/refund`, { method: "POST" }, f);
    },
    async acceptReturn(merchantId: string, returnId: string): Promise<void> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/accept`, { method: "POST" }, f);
    },
  };
}
