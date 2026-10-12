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
  refund?: { amountInCents: number; status: string; processedAt?: string };
}

export interface ReturnListResponse {
  returns: ReturnEntry[];
  total: number;
}

export type ReverseParcel = { height: number; width: number; length: number; weight: number };
export type ReverseShippingView = {
  returnId: string; amountCents: number;
  shipments: Array<{ id: string; originMerchantId: string; originName: string; amountCents: number | null;
    status: string; postingCode: string | null; serviceId: 1 | 2 }>;
  candidates?: Array<{ originMerchantId: string; originName: string; package: ReverseParcel | null; email: string; phone: string }>;
};

export function returnsEndpoints(base: string, f: typeof fetch) {
  return {
    async getReturnReverseShipping(merchantId: string, returnId: string): Promise<ReverseShippingView> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${encodeURIComponent(returnId)}/reverse-shipping`, { method: "GET" }, f);
    },
    async prepareReturnReverseShipping(merchantId: string, returnId: string, input: { serviceId: 1 | 2;
      packages: Array<{ originMerchantId: string; package: ReverseParcel; email: string; phone: string }> }): Promise<ReverseShippingView> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${encodeURIComponent(returnId)}/reverse-shipping/prepare`, { method: "POST", jsonBody: input }, f);
    },
    async confirmReturnReverseShipping(merchantId: string, returnId: string, expectedAmountCents: number): Promise<ReverseShippingView> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${encodeURIComponent(returnId)}/reverse-shipping/confirm`, { method: "POST", jsonBody: { expectedAmountCents } }, f);
    },
    async listReturns(merchantId: string, params?: { status?: ReturnStatus; limit?: number; offset?: number }): Promise<ReturnListResponse> {
      const query = new URLSearchParams();
      if (params?.status) query.set("status", params.status);
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.offset) query.set("offset", String(params.offset));
      const qs = query.toString();
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns${qs ? `?${qs}` : ""}`, { method: "GET" }, f);
    },

    async generateReturnLabel(merchantId: string, returnId: string, label: { carrier: string; trackingNumber: string; labelUrl?: string }): Promise<ReturnEntry> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${encodeURIComponent(returnId)}/label`, { method: "POST", jsonBody: label }, f);
    },

    async markReturnReceived(merchantId: string, returnId: string): Promise<ReturnEntry> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/receive`, { method: "POST" }, f);
    },

    async inspectReturn(merchantId: string, returnId: string, data: { itemCondition: ReturnItemCondition; verdict: string; notes?: string }): Promise<ReturnEntry> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/inspect`, { method: "POST", jsonBody: data }, f);
    },

    async processRefund(merchantId: string, returnId: string): Promise<Pick<ReturnEntry, "status" | "refund">> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/refund`, { method: "POST" }, f);
    },
    async previewReturnRefund(merchantId: string, returnId: string): Promise<{ amountCents: number; alreadySubmitted: boolean }> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${encodeURIComponent(returnId)}/refund-preview`, { method: "GET" }, f);
    },
    async acceptReturn(merchantId: string, returnId: string): Promise<{ status: ReturnStatus; refund?: ReturnEntry["refund"] }> {
      return dashboardJson(base, `/merchants/${encodeURIComponent(merchantId)}/returns/${returnId}/accept`, { method: "POST" }, f);
    },
  };
}
