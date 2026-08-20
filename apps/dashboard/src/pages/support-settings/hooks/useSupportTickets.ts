import { useCallback, useEffect, useState } from "react";
import type { SupportTicket, SupportTicketStatus } from "@zyon/shared-types";
import { DashboardHttpError } from "../../../api-client.js";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../hooks/useErrorReporter.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;

export function useSupportTickets(api: DashboardApi) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<SupportTicketStatus | "all">("all");
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketBusy, setTicketBusy] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [ticketStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const t = await api.getSupportTickets(ticketStatusFilter === "all" ? undefined : ticketStatusFilter);
      setTickets(Array.isArray(t) ? t : []);
    } catch (e) {
      const text = e instanceof DashboardHttpError
        ? e.responseBody.slice(0, 160)
        : e instanceof Error ? e.message : String(e);
      showToast("error", `Erro ao carregar chamados: ${text}`);
      reportError({ source: "useSupportTickets.load", error: e });
    } finally {
      setLoading(false);
    }
  }

  const updateTicketStatus = useCallback(async (ticketId: string, status: SupportTicketStatus) => {
    setTicketBusy(ticketId);
    try {
      const updated = await api.patchSupportTicketStatus(ticketId, status);
      setTickets((prev) => prev.map((ticket) => (ticket.id === ticketId ? updated : ticket)));
      showToast("success", "Chamado atualizado");
    } catch (e) {
      const text = e instanceof DashboardHttpError
        ? e.responseBody.slice(0, 160)
        : e instanceof Error ? e.message : String(e);
      showToast("error", `Erro ao atualizar: ${text}`);
      reportError({ source: "useSupportTickets.updateStatus", error: e });
    } finally {
      setTicketBusy(null);
    }
  }, [api]);

  return {
    tickets,
    loading,
    ticketStatusFilter,
    setTicketStatusFilter,
    openTicketId,
    setOpenTicketId,
    ticketPage,
    setTicketPage,
    updateTicketStatus,
    ticketBusy,
    reload: load,
  };
}
