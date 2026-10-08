import React, { useState, useMemo } from "react";
import {
  Ticket,
  Clock,
  MessageSquare,
  CheckCircle,
  XCircle,
  User,
  Download,
} from "lucide-react";
import { StatCard } from "../../overview/components/StatCard.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { SupportChatDrawer } from "../components/SupportChatDrawer.js";
import { useSupportTickets } from "../hooks/useSupportTickets.js";
import { Button } from "../../../components/Button.js";
import { PeriodFilter } from "../../../components/PeriodFilter.js";
import { SearchInput } from "../../../components/SearchInput.js";
import { downloadCsv } from "../../../hooks/useCsvExport.js";
import type { SupportTicketStatus } from "@zyon/shared-types";
import { createDashboardApi } from "../../../api-client.js";
import { useSupportSocket } from "../../../hooks/useSupportSocket.js";

type DashboardApi = ReturnType<typeof createDashboardApi>;

interface Props {
  api: DashboardApi;
  socket: ReturnType<typeof useSupportSocket>;
}

interface KanbanColumn {
  id: SupportTicketStatus;
  label: string;
  color: string;
  icon: React.ReactNode;
  acceptsFrom: SupportTicketStatus[];
}

const COLUMNS: KanbanColumn[] = [
  { id: "open", label: "Abertos", color: "var(--color-warning)", icon: <Clock size={14} />, acceptsFrom: [] },
  { id: "in_progress", label: "Em atendimento", color: "var(--color-brand)", icon: <MessageSquare size={14} />, acceptsFrom: ["open"] },
  { id: "resolved", label: "Resolvidos", color: "var(--color-success)", icon: <CheckCircle size={14} />, acceptsFrom: ["open", "in_progress"] },
  { id: "closed", label: "Fechados", color: "var(--color-text-faint)", icon: <XCircle size={14} />, acceptsFrom: ["open", "in_progress", "resolved"] },
];

function canDrop(fromStatus: SupportTicketStatus, toColumn: SupportTicketStatus): boolean {
  if (fromStatus === toColumn) return false;
  const col = COLUMNS.find((c) => c.id === toColumn);
  return col ? col.acceptsFrom.includes(fromStatus) : false;
}

export function SupportTicketsTab(props: Props) {
  const {
    tickets,
    loading,
    openTicketId,
    setOpenTicketId,
    updateTicketStatus,
    ticketBusy,
    loadError,
    actionError,
    reload,
  } = useSupportTickets(props.api);

  const [draggedTicket, setDraggedTicket] = useState<(typeof tickets)[0] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [period, setPeriod] = useState<"all" | "today" | "7d" | "15d" | "30d">("today");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: "", to: "" });

  const [search, setSearch] = useState("");
  const selectedTicket = tickets.find((t) => t.id === openTicketId);

  const filteredTickets = useMemo(() => {
    const hasCustomRange = Boolean(dateRange.from || dateRange.to);
    let result = tickets;

    if (hasCustomRange) {
      // Custom date range takes over the preset
      if (dateRange.from) result = result.filter((t) => new Date(t.createdAt).toISOString() >= dateRange.from);
      if (dateRange.to) result = result.filter((t) => new Date(t.createdAt).toISOString() <= dateRange.to + "T23:59:59");
    } else if (period !== "all") {
      // Preset period filter (relative to now)
      const days = period === "today" ? 0 : period === "7d" ? 7 : period === "15d" ? 15 : 30;
      const cutoff = new Date();
      if (period === "today") cutoff.setHours(0, 0, 0, 0);
      else cutoff.setDate(cutoff.getDate() - days);
      const cutoffIso = cutoff.toISOString();
      const nextDay = new Date(cutoff);
      nextDay.setDate(nextDay.getDate() + 1);
      result = result.filter((t) => new Date(t.createdAt).toISOString() >= cutoffIso && (period !== "today" || new Date(t.createdAt) < nextDay));
    }

    const term = search.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return result.filter(ticket => [ticket.id, ticket.buyerMessage, ticket.sessionId].some(value => value?.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(term)));
  }, [tickets, period, dateRange, search]);

  const openCount = filteredTickets.filter((t) => t.status === "open").length;
  const inProgressCount = filteredTickets.filter((t) => t.status === "in_progress").length;
  const resolvedCount = filteredTickets.filter((t) => t.status === "resolved").length;

  function handleDragStart(e: React.DragEvent, ticket: (typeof tickets)[0]) {
    if (ticketBusy) return;
    setDraggedTicket(ticket);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ticket.id);
  }

  function handleDragEnd() {
    setDraggedTicket(null);
    setDropTarget(null);
  }

  function handleDragOver(e: React.DragEvent, columnId: SupportTicketStatus) {
    if (!draggedTicket) return;
    if (!canDrop(draggedTicket.status, columnId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(columnId);
  }

  function handleDragLeave() {
    setDropTarget(null);
  }

  function handleDrop(e: React.DragEvent, columnId: SupportTicketStatus) {
    e.preventDefault();
    setDropTarget(null);
    if (!draggedTicket) return;
    if (!canDrop(draggedTicket.status, columnId)) return;


    void updateTicketStatus(draggedTicket.id, columnId);

    setDraggedTicket(null);
  }

  if (loading && tickets.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="skeleton" style={{ height: 52, borderRadius: "var(--radius-md)" }} />
        <div className="skeleton" style={{ height: 300, borderRadius: "var(--radius-md)" }} />
      </div>
    );
  }

  if (loadError && tickets.length === 0) return <EmptyState icon={Ticket} title="Chamados indisponíveis" description={loadError} action={<Button variant="outline" onClick={() => void reload()}>Tentar novamente</Button>} />;

  if (tickets.length === 0) {
    return (
      <EmptyState
        icon={Ticket}
        title="Nenhum chamado"
        description="Chamados aparecem quando o agente IA encaminha uma conversa para atendimento humano."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--page-section-gap, 24px)" }}>
      {/* KPIs */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard label="Total" value={filteredTickets.length} icon={<Ticket size={16} />} />
        <StatCard label="Abertos" value={openCount} icon={<Clock size={16} />} accent={openCount > 0 ? "var(--color-warning)" : undefined} />
        <StatCard label="Em atendimento" value={inProgressCount} icon={<MessageSquare size={16} />} accent={inProgressCount > 0 ? "var(--color-brand)" : undefined} />
        <StatCard label="Resolvidos" value={resolvedCount} icon={<CheckCircle size={16} />} accent="var(--color-success)" />
      </div>

      {loadError && <div className="panel-error" role="alert">{loadError}<Button variant="outline" size="sm" onClick={() => void reload()}>Tentar novamente</Button></div>}
      {actionError && <div className="panel-error" role="alert">{actionError}</div>}
      <PeriodFilter presets={[{ key: "all", label: "Todos" }, { key: "today", label: "Hoje" }, { key: "7d", label: "Últimos 7 dias" }, { key: "15d", label: "Últimos 15 dias" }, { key: "30d", label: "Últimos 30 dias" }]} active={dateRange.from || dateRange.to ? "custom" : period} onPreset={key => { setPeriod(key as typeof period); setDateRange({ from: "", to: "" }); }} from={dateRange.from} to={dateRange.to} onDate={(field, value) => setDateRange(current => ({ ...current, [field]: value }))} action={<Button variant="outline" size="sm" disabled={!filteredTickets.length} onClick={() => { const header = "Chamado,Etapa,Mensagem,Criado em"; const cell = (value: string) => '"' + (/^[=+\-@]/.test(value.trimStart()) ? "'" : "") + value.replace(/"/g, '""') + '"'; downloadCsv(header, filteredTickets.map(ticket => [ticket.id, COLUMNS.find(column => column.id === ticket.status)?.label || ticket.status, ticket.buyerMessage || "", ticket.createdAt].map(cell).join(",")), "chamados.csv"); }}><Download size={14} /> Exportar CSV</Button>} />
      <div className="support-tickets__toolbar"><p>Abra um chamado para responder e atualizar a etapa do atendimento.</p><SearchInput value={search} onChange={setSearch} placeholder="Buscar chamado ou mensagem" width={320} /></div>
      {!filteredTickets.length && <EmptyState icon={Ticket} title="Nenhum chamado com estes filtros" description="Altere a busca ou o período para encontrar o atendimento." action={<Button variant="outline" onClick={() => { setSearch(""); setPeriod("today"); setDateRange({ from: "", to: "" }); }}>Limpar filtros</Button>} />}
      {/* Kanban Board */}
      <div className="support-tickets__board" role="region" aria-label="Chamados por etapa" tabIndex={0}
        onDragEnd={handleDragEnd}
      >
        {COLUMNS.map((col) => {
          const colTickets = filteredTickets.filter((t) => t.status === col.id);
          const isHovering = dropTarget === col.id;
          const isValidTarget = draggedTicket ? canDrop(draggedTicket.status, col.id) : false;

          return (
            <div
              key={col.id}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
              style={{
                border: `1px solid ${isHovering ? col.color : isValidTarget && draggedTicket ? "var(--color-border)" : "var(--color-border)"}`,
                borderRadius: "var(--radius-md)",
                background: isHovering ? `color-mix(in srgb, ${col.color} 5%, transparent)` : "var(--surface-1)",
                display: "flex",
                flexDirection: "column",
                transition: "border-color 0.15s, background 0.15s",
                overflow: "hidden",
              }}
            >
              {/* Column header */}
              <div style={{
                padding: "12px 14px",
                borderBottom: `2px solid ${col.color}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <span style={{ color: col.color }}>{col.icon}</span>
                <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>
                  {col.label}
                </span>
                <span style={{
                  marginLeft: "auto",
                  padding: "1px 6px",
                  borderRadius: "var(--radius-full)",
                  font: "600 10px var(--font-mono)",
                  background: "var(--surface-2)",
                  color: "var(--color-text-muted)",
                }}>
                  {colTickets.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
                {colTickets.length === 0 && (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>
                    {draggedTicket && isValidTarget ? "Solte aqui" : "—"}
                  </div>
                )}
                {colTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    role="button"
                    tabIndex={ticketBusy ? -1 : 0}
                    aria-label={"Abrir chamado " + ticket.id.slice(0, 8)}
                    aria-disabled={Boolean(ticketBusy)}
                    className="support-ticket-card"
                    onKeyDown={event => { if (!ticketBusy && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setOpenTicketId(ticket.id); } }}
                    draggable={!ticketBusy}
                    onDragStart={(e) => handleDragStart(e, ticket)}
                    onClick={() => { if (!ticketBusy) setOpenTicketId(ticket.id); }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: draggedTicket?.id === ticket.id ? "var(--surface-2)" : "var(--surface-0)",
                      cursor: "grab",
                      opacity: draggedTicket?.id === ticket.id ? 0.5 : 1,
                      transition: "opacity 0.15s, box-shadow 0.15s",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {/* Buyer info */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <User size={12} color="var(--color-text-muted)" />
                      <span style={{ font: "500 11px var(--font-sans)", color: "var(--color-text)" }}>
                        {ticket.sessionId ? `Sessão ${ticket.sessionId.slice(0, 8)}…` : "Comprador"}
                      </span>
                    </div>

                    {/* Message preview */}
                    <p style={{
                      margin: 0,
                      font: "12px var(--font-sans)",
                      color: "var(--color-text-muted)",
                      lineHeight: 1.4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}>
                      {ticket.buyerMessage}
                    </p>

                    {/* Footer */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ font: "10px var(--font-mono)", color: "var(--color-text-faint)" }}>
                        #{ticket.id.slice(0, 8)}
                      </span>
                      <span style={{ font: "10px var(--font-mono)", color: "var(--color-text-faint)" }}>
                        {new Date(ticket.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Support Chat Drawer */}
      {openTicketId && selectedTicket ? (
        <SupportChatDrawer
          key={openTicketId}
          ticketId={openTicketId}
          connected={props.socket.connected}
          busy={Boolean(ticketBusy)}
          actionError={actionError}
          onStatus={next => void updateTicketStatus(openTicketId, next)}
          statusOptions={COLUMNS.filter(column => column.acceptsFrom.includes(selectedTicket.status)).map(column => ({ value: column.id, label: column.label }))}
          buyerMessage={selectedTicket.buyerMessage}
          status={selectedTicket.status}
          api={props.api}
          onClose={() => setOpenTicketId(null)}
          onSend={props.socket.sendMessage}
          onJoin={props.socket.joinTicket}
          onLeave={props.socket.leaveTicket}
          onNewMessage={props.socket.onNewMessage}
        />
      ) : null}
    </div>
  );
}
