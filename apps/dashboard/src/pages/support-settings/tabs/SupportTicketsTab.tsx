import React, { useState } from "react";
import {
  AlertTriangle,
  Ticket,
  Clock,
  MessageSquare,
  Filter,
  ChevronDown,
} from "lucide-react";
import { StatCard } from "../../overview/components/StatCard.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { Pagination } from "../../../components/Pagination.js";
import { SupportChatDrawer } from "../components/SupportChatDrawer.js";
import { useSupportTickets } from "../hooks/useSupportTickets.js";
import { TicketStatusBadge } from "../components/TicketStatusBadge.js";
import type { SupportTicketStatus } from "@zyon/shared-types";
import { createDashboardApi } from "../../../api-client.js";
import { useSupportSocket } from "../../../hooks/useSupportSocket.js";

type DashboardApi = ReturnType<typeof createDashboardApi>;

interface Props {
  api: DashboardApi;
  socket: ReturnType<typeof useSupportSocket>;
}

const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Aberto",
  in_progress: "Em atendimento",
  resolved: "Resolvido",
  closed: "Fechado"
};

const SUPPORT_STATUSES = Object.keys(SUPPORT_STATUS_LABELS) as SupportTicketStatus[];

export function SupportTicketsTab(props: Props) {
  const {
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
  } = useSupportTickets(props.api);

  const ticketPageSize = 10;
  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter((t) => t.status === "in_progress").length;

  const paginatedTickets = tickets.slice((ticketPage - 1) * ticketPageSize, ticketPage * ticketPageSize);
  const selectedTicket = tickets.find((t) => t.id === openTicketId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      {/* ── Ticket summary strip ── */}
      {!loading && tickets.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
            marginBottom: "var(--space-3)",
          }}
        >
          <StatCard
            label="Total de chamados"
            value={tickets.length}
            icon={<Ticket size={16} />}
          />
          <StatCard
            label="Em aberto"
            value={openCount}
            icon={<Clock size={16} />}
            accent={openCount > 0 ? "var(--warn)" : undefined}
          />
          <StatCard
            label="Em atendimento"
            value={inProgressCount}
            icon={<MessageSquare size={16} />}
            accent={inProgressCount > 0 ? "var(--accent)" : undefined}
          />
        </div>
      ) : null}

      {/* ── Loading skeleton ── */}
      {loading && tickets.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="skeleton" style={{ height: 52, borderRadius: "var(--radius-md)" }} />
          <div className="skeleton" style={{ height: 280, borderRadius: "var(--radius-md)" }} />
        </div>
      ) : null}

      {/* ── Tickets Section ── */}
      {!loading || tickets.length > 0 ? (
        <section className="panel stacked">
          <SectionHeader
            title="Escalonamento"
            subtitle="Encaminhe conversas para seu time quando necessário"
            trailing={<span className="badge muted" style={{ fontFamily: "var(--font-data)", fontSize: 11 }}>{tickets.length}</span>}
          />

          {/* Status filter */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              marginBottom: "var(--space-3)",
            }}
          >
            <Filter size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <select
                value={ticketStatusFilter}
                onChange={(e) => setTicketStatusFilter(e.target.value as SupportTicketStatus | "all")}
                style={{
                  minHeight: 32,
                  fontSize: 12,
                  fontWeight: 600,
                  paddingRight: 28,
                  appearance: "none",
                  WebkitAppearance: "none",
                  cursor: "pointer",
                }}
              >
                <option value="all">Todos os status</option>
                {SUPPORT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {SUPPORT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                style={{
                  position: "absolute",
                  right: 8,
                  pointerEvents: "none",
                  color: "var(--color-text-muted)",
                }}
              />
            </div>
          </div>

          {tickets.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="Nenhum chamado"
              description={ticketStatusFilter === "all"
                ? "Nenhum chamado de suporte criado por handoff até o momento."
                : `Nenhum chamado com status "${SUPPORT_STATUS_LABELS[ticketStatusFilter as SupportTicketStatus]}".`}
            />
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {paginatedTickets.map((ticket) => (
                  <article
                    key={ticket.id}
                    onClick={() => setOpenTicketId(ticket.id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: "var(--space-4)",
                      alignItems: "start",
                      padding: "var(--space-4)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-surface)",
                      transition: "border-color 150ms",
                      cursor: "pointer",
                    }}
                  >
                    {/* Ticket info */}
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                        <TicketStatusBadge status={ticket.status} />
                        <code
                          style={{
                            fontFamily: "var(--font-data)",
                            fontSize: 11,
                            color: "var(--color-text-faint)",
                          }}
                        >
                          #{ticket.id.slice(0, 12)}
                        </code>
                      </div>

                      <p
                        style={{
                          fontSize: 13,
                          color: "var(--color-text)",
                          margin: 0,
                          lineHeight: 1.5,
                        }}
                      >
                        {ticket.buyerMessage}
                      </p>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                          color: "var(--color-text-faint)",
                          fontSize: 11,
                          fontFamily: "var(--font-data)",
                        }}
                      >
                        <Clock size={11} />
                        {ticket.sessionId ? (
                          <>
                            Sessão{" "}
                            <code style={{ fontFamily: "var(--font-data)", fontSize: 11 }}>
                              {ticket.sessionId.slice(0, 8)}…
                            </code>
                            {" · "}
                          </>
                        ) : null}
                        {new Date(ticket.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) +
                         " " + new Date(ticket.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>

                    {/* Status change */}
                    <div style={{ flexShrink: 0 }}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--color-text-muted)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          display: "block",
                          marginBottom: "var(--space-1)",
                        }}
                      >
                        Status
                      </label>
                      <select
                        value={ticket.status}
                        disabled={ticketBusy === ticket.id}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          void updateTicketStatus(ticket.id, e.target.value as SupportTicketStatus)
                        }
                        style={{ minHeight: 32, fontSize: 12 }}
                      >
                        {SUPPORT_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {SUPPORT_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
              </div>
              {tickets.length > ticketPageSize ? (
                <Pagination
                  page={ticketPage}
                  pageSize={ticketPageSize}
                  total={tickets.length}
                  onChange={setTicketPage}
                />
              ) : null}
            </>
          )}
        </section>
      ) : null}

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
