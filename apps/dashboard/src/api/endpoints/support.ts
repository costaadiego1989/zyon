import { dashboardJson } from "../http/client.js";
import type {
  SupportSettings,
  SupportSettingsPatch,
  SupportTicket,
  SupportTicketStatus,
  SupportTicketStatusPatch,
} from "../types.js";
import type { TicketMessage } from "../../hooks/useSupportSocket.js";
import type { SupportCaseDetail, SupportRefundPreview } from "@zyon/shared-types";

export type OperatorSupportCase = SupportCaseDetail & { canRefund: boolean };

export function supportEndpoints(base: string, f: typeof fetch) {
  return {
    getSupportTicket(ticketId: string): Promise<SupportTicket> {
      return dashboardJson(base, `/support/tickets/${encodeURIComponent(ticketId)}`, { method: "GET" }, f);
    },
    getReturnSupportCase(returnId: string): Promise<{ ticketId: string }> {
      return dashboardJson(base, `/support/tickets/for-return/${encodeURIComponent(returnId)}`, { method: "POST" }, f);
    },
    async getSupportCase(ticketId: string): Promise<OperatorSupportCase> {
      const path = `/support/tickets/${encodeURIComponent(ticketId)}/case`;
      let detail = await dashboardJson<OperatorSupportCase>(base, path, { method: "GET" }, f);
      let cursor = detail.nextCursor;
      while (cursor) {
        const page = await dashboardJson<OperatorSupportCase>(base, `${path}?cursor=${encodeURIComponent(cursor)}`, { method: "GET" }, f);
        detail = { ...page, messages: [...detail.messages, ...page.messages] }; cursor = page.nextCursor;
      }
      const url = (value: string) => value.startsWith("/support/") ? `${base.replace(/\/$/, "")}${value}` : value;
      return { ...detail, imageUrls: detail.imageUrls.map(url), messages: detail.messages.map(message => ({ ...message, metadata: message.metadata ? { ...message.metadata, imageUrls: message.metadata.imageUrls?.map(url) } : null })) };
    },
    markSupportCaseRead(ticketId: string, lastMessageId: string) {
      return dashboardJson(base, `/support/tickets/${encodeURIComponent(ticketId)}/read`, { method: "POST", jsonBody: { lastMessageId } }, f);
    },
    getSupportRefundPreview(ticketId: string): Promise<SupportRefundPreview> {
      return dashboardJson(base, `/support/tickets/${encodeURIComponent(ticketId)}/refund-preview`, { method: "GET" }, f);
    },
    confirmSupportRefund(ticketId: string, expectedAmountCents: number): Promise<OperatorSupportCase> {
      return dashboardJson(base, `/support/tickets/${encodeURIComponent(ticketId)}/refund`, { method: "POST", jsonBody: { expectedAmountCents } }, f);
    },
    recoverSupportRefund(ticketId: string, expectedAmountCents: number): Promise<OperatorSupportCase> {
      return dashboardJson(base, `/support/tickets/${encodeURIComponent(ticketId)}/refund-recovery`, {
        method: "POST", jsonBody: { expectedAmountCents, confirmed: true }
      }, f);
    },
    supportCaseAction(ticketId: string, input: { action: string; notes: string; replacementOrderId?: string; trackingCode?: string; labelUrl?: string; itemCondition?: string; deliveryConfirmed?: boolean; items?: Array<{ variantId: string; quantity: number }> }): Promise<OperatorSupportCase> {
      return dashboardJson(base, `/support/tickets/${encodeURIComponent(ticketId)}/actions`, { method: "POST", jsonBody: input }, f);
    },
    getSupportSettings(): Promise<SupportSettings> {
      return dashboardJson(base, "/support/settings", { method: "GET" }, f);
    },

    putSupportSettings(patch: SupportSettingsPatch): Promise<SupportSettings> {
      return dashboardJson(base, "/support/settings", { method: "PUT", jsonBody: patch }, f);
    },

    async getSupportTickets(status?: SupportTicketStatus): Promise<SupportTicket[]> {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const response = await dashboardJson<
        SupportTicket[] | { data: SupportTicket[] }
      >(base, `/support/tickets${query}`, { method: "GET" }, f);
      return Array.isArray(response) ? response : response.data;
    },

    patchSupportTicketStatus(
      ticketId: string,
      status: SupportTicketStatus
    ): Promise<SupportTicket> {
      const patch: SupportTicketStatusPatch = { status };
      return dashboardJson(
        base,
        `/support/tickets/${encodeURIComponent(ticketId)}`,
        { method: "PATCH", jsonBody: patch },
        f
      );
    },

    async getTicketMessages(ticketId: string, limit = 100): Promise<TicketMessage[]> {
      const query = `?limit=${encodeURIComponent(String(limit))}`;
      const response = await dashboardJson<
        TicketMessage[] | { data: TicketMessage[] }
      >(base, `/support/tickets/${encodeURIComponent(ticketId)}/messages${query}`, { method: "GET" }, f);
      return Array.isArray(response) ? response : (response?.data ?? []);
    },

    sendTicketMessage(ticketId: string, content: string, clientMessageId?: string): Promise<TicketMessage> {
      return dashboardJson(
        base,
        `/support/tickets/${encodeURIComponent(ticketId)}/messages`,
        { method: "POST", jsonBody: { content, clientMessageId } },
        f
      );
    },

    getTicketMarketplaceOrigin(
      ticketId: string
    ): Promise<{ isMarketplaceOrigin: boolean; sellerMerchantIds: string[] }> {
      return dashboardJson(
        base,
        `/support/tickets/${encodeURIComponent(ticketId)}/marketplace-origin`,
        { method: "GET" },
        f
      );
    },

    transferTicket(
      ticketId: string,
      targetMerchantId: string
    ): Promise<{ ticketId: string; toMerchantId: string; toStoreName: string }> {
      return dashboardJson(
        base,
        `/support/tickets/${encodeURIComponent(ticketId)}/transfer`,
        { method: "POST", jsonBody: { targetMerchantId } },
        f
      );
    },

    listPartnerStores(
      q?: string
    ): Promise<{ stores: Array<{ merchantId: string; storeName: string }> }> {
      const query = q ? `?q=${encodeURIComponent(q)}` : "";
      return dashboardJson(base, `/marketplace/stores/partners${query}`, { method: "GET" }, f);
    },
  };
}
