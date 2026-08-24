import React, { useState } from "react";
import {
  Ticket,
  Clock,
  MessageSquare,
  CheckCircle,
  XCircle,
  User,
} from "lucide-react";
import { StatCard } from "../../overview/components/StatCard.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { SupportChatDrawer } from "../components/SupportChatDrawer.js";
import { useSupportTickets } from "../hooks/useSupportTickets.js";
import { showToast } from "../../../components/Toast.js";
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
  } = useSupportTickets(props.api);

  const [draggedTicket, setDraggedTicket] = useState<(typeof tickets)[0] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const selectedTicket = tickets.find((t) => t.id === openTicketId);

  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter((t) => t.status === "in_progress").length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;

  function handleDragStart(e: React.DragEvent, ticket: (typeof tickets)[0]) {
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

    const col = COLUMNS.find((c) => c.id === columnId);
    void updateTicketStatus(draggedTicket.id, columnId);
    showToast("success", `Chamado → ${col?.label ?? columnId}`);
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPIs */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard label="Total" value={tickets.length} icon={<Ticket size={16} />} />
        <StatCard label="Abertos" value={openCount} icon={<Clock size={16} />} accent={openCount > 0 ? "var(--color-warning)" : undefined} />
        <StatCard label="Em atendimento" value={inProgressCount} icon={<MessageSquare size={16} />} accent={inProgressCount > 0 ? "var(--color-brand)" : undefined} />
        <StatCard label="Resolvidos" value={resolvedCount} icon={<CheckCircle size={16} />} accent="var(--color-success)" />
      </div>

      {/* Kanban instruction */}
      <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)", textAlign: "center" }}>
        Arraste os cards entre colunas para atualizar o status do chamado
      </div>

      {/* Kanban Board */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`,
          gap: 12,
          minHeight: 400,
        }}
        onDragEnd={handleDragEnd}
      >
        {COLUMNS.map((col) => {
          const colTickets = tickets.filter((t) => t.status === col.id);
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
                    draggable
                    onDragStart={(e) => handleDragStart(e, ticket)}
                    onClick={() => setOpenTicketId(ticket.id)}
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
          ticketId={openTicketId}
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
