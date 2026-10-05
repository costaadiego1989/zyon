import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportTicket, SupportTicketStatus } from "@zyon/shared-types";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const updating = useRef(false);
  const generation = useRef(0);
  const openRef = useRef(openTicketId); openRef.current = openTicketId;
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const rows = await api.getSupportTickets(ticketStatusFilter === "all" ? undefined : ticketStatusFilter);
      const selected = openRef.current;
      if (selected && !rows.some(row => row.id === selected)) {
        const recovered = await api.getSupportTicket(selected); rows.unshift(recovered);
        if (current === generation.current && recovered.id !== selected) { openRef.current = recovered.id; setOpenTicketId(recovered.id); }
      }
      if (current === generation.current) { setTickets(rows); setLoadError(null); }
    } catch (e) {
      if (current === generation.current) setLoadError("Não foi possível atualizar os chamados. Tente novamente.");
      reportError({ source: "useSupportTickets.load", error: e });
    } finally { if (current === generation.current) setLoading(false); }
  }, [api, ticketStatusFilter]);
  useEffect(() => {
    const followLink = () => {
      const id = new URLSearchParams(window.location.hash.split("?")[1]).get("ticket");
      if (id) { openRef.current = id; setOpenTicketId(id); }
      void reload();
    };
    followLink();
    const update = () => { if (!document.hidden) void reload(); };
    const timer = window.setInterval(update, 5000);
    window.addEventListener("focus", update); window.addEventListener("hashchange", followLink);
    return () => { generation.current++; window.clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("hashchange", followLink); };
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
