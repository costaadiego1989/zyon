import { dashboardJson } from "../http/client.js";
import type {
  SupportSettings,
  SupportSettingsPatch,
  SupportTicket,
  SupportTicketStatus,
  SupportTicketStatusPatch,
} from "../types.js";
import type { TicketMessage } from "../../hooks/useSupportSocket.js";

export function supportEndpoints(base: string, f: typeof fetch) {
  return {
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

    sendTicketMessage(ticketId: string, content: string): Promise<TicketMessage> {
      return dashboardJson(
        base,
        `/support/tickets/${encodeURIComponent(ticketId)}/messages`,
        { method: "POST", jsonBody: { content } },
        f
      );
    },
  };
}
