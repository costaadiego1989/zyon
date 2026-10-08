import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportTicket, SupportTicketStatus } from "@zyon/shared-types";
import { showToast } from "../../../components/Toast.js";
import { useSupportRefresh } from "./useSupportRefresh.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;

export function useSupportTickets(api: DashboardApi) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<SupportTicketStatus | "all">("all");
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketBusy, setTicketBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const updating = useRef(false);
  const openRef = useRef(openTicketId); openRef.current = openTicketId;
  const load = useCallback(async () => {
    const rows = await api.getSupportTickets(ticketStatusFilter === "all" ? undefined : ticketStatusFilter);
    const selected = openRef.current;
    let recoveredId: string | undefined;
    if (selected && !rows.some(row => row.id === selected)) {
      const recovered = await api.getSupportTicket(selected); recoveredId = recovered.id; rows.unshift(recovered);
    }
    return { rows, selected, recoveredId };
  }, [api, ticketStatusFilter]);
  const { data, loading, error: loadError, reload } = useSupportRefresh(api, `tickets:${ticketStatusFilter}`, load, 30000);
  useEffect(() => {
    if (!data) return;
    setTickets(data.rows);
    if (data.recoveredId && data.selected === openRef.current && data.recoveredId !== data.selected) {
      openRef.current = data.recoveredId; setOpenTicketId(data.recoveredId);
    }
  }, [data]);
  useEffect(() => {
    const followLink = () => {
      const id = new URLSearchParams(window.location.hash.split("?")[1]).get("ticket");
      if (id) { openRef.current = id; setOpenTicketId(id); }
      void reload();
    };
    followLink(); window.addEventListener("hashchange", followLink);
    return () => window.removeEventListener("hashchange", followLink);
  }, [reload]);
  const updateTicketStatus = useCallback(async (ticketId: string, status: SupportTicketStatus) => {
    if (updating.current) return;
    updating.current = true; setTicketBusy(ticketId); setActionError(null);
    try {
      const updated = await api.patchSupportTicketStatus(ticketId, status);
      setTickets(previous => previous.map(ticket => ticket.id === ticketId ? updated : ticket));
      showToast("success", "Chamado atualizado");
    } catch (e) {
      setActionError("Não foi possível atualizar a etapa. Trocas e devoluções precisam ser resolvidas na conversa antes de encerrar o chamado.");
      reportError({ source: "useSupportTickets.updateStatus", error: e });
    } finally { updating.current = false; setTicketBusy(null); }
  }, [api]);
  return { tickets, loading, ticketStatusFilter, setTicketStatusFilter, openTicketId, setOpenTicketId, ticketPage, setTicketPage, updateTicketStatus, ticketBusy, loadError, actionError, reload };
}
