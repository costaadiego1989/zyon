import React, { useEffect, useMemo, useState } from "react";
import {
  Plus,
  RefreshCw,
  Save,
  Trash2,
  MessageSquare,
  HelpCircle,
  Ticket,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
} from "lucide-react";
import { Button } from "../components/Button.js";
import type {
  SupportFaqItem,
  SupportSettings,
  SupportTicket,
  SupportTicketStatus
} from "@zyon/shared-types";
import {
  createDashboardApi,
  DashboardHttpError,
  type MerchantProfile as MerchantMeProfile,
} from "../api-client.js";

function newItem(): SupportFaqItem {
  return { id: crypto.randomUUID(), question: "", answer: "" };
}

export function formatPtBrDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function validateFaqItems(items: SupportFaqItem[]): Array<{ question: boolean; answer: boolean }> {
  return items.map((it) => ({
    question: !it.question.trim(),
    answer: !it.answer.trim(),
  }));
}

export function moveItemInList<T extends { id: string }>(
  items: T[],
  id: string,
  direction: "up" | "down",
): T[] {
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return items.slice();
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return items.slice();
  const next = items.slice();
  const a = next[idx]!;
  const b = next[swapWith]!;
  next[idx] = b;
  next[swapWith] = a;
  return next;
}

export function filterTickets<T extends { id: string; buyerMessage: string }>(
  tickets: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return tickets.slice();
  return tickets.filter(
    (t) =>
      t.id.toLowerCase().includes(q) ||
      (t.buyerMessage ?? "").toLowerCase().includes(q),
  );
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): { paginated: T[]; hasMore: boolean } {
  const start = (page - 1) * pageSize;
  const paginated = items.slice(start, start + pageSize);
  const hasMore = start + paginated.length < items.length;
  return { paginated, hasMore };
}

const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Aberto",
  in_progress: "Em atendimento",
  resolved: "Resolvido",
  closed: "Fechado"
};

const SUPPORT_STATUSES = Object.keys(SUPPORT_STATUS_LABELS) as SupportTicketStatus[];

const STATUS_BADGE: Record<SupportTicketStatus, string> = {
  open: "warn",
  in_progress: "muted",
  resolved: "ok",
  closed: "muted",
};

const STATUS_DOT: Record<SupportTicketStatus, string> = {
  open: "amber",
  in_progress: "blue",
  resolved: "green",
  closed: "",
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SupportSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div className="skeleton" style={{ height: 52, borderRadius: "var(--radius-md)" }} />
      <div className="skeleton" style={{ height: 180, borderRadius: "var(--radius-md)" }} />
      <div className="skeleton" style={{ height: 280, borderRadius: "var(--radius-md)" }} />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SupportSettingsPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [items, setItems] = useState<SupportFaqItem[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<SupportTicketStatus | "all">("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ticketBusy, setTicketBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!props.me) {
      setSettings(null);
      setItems([]);
      setTickets([]);
      return;
    }
    void load();
  }, [props.me, ticketStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const [s, t] = await Promise.all([
        api.getSupportSettings(),
        api.getSupportTickets(ticketStatusFilter === "all" ? undefined : ticketStatusFilter)
      ]);
      const settings = s && typeof s === "object" && !Array.isArray(s) ? s : null;
      setSettings(settings);
      setItems(settings?.faqItems ?? []);
      setTickets(Array.isArray(t) ? t : []);
    } catch (e) {
      const text = e instanceof DashboardHttpError
        ? e.responseBody.slice(0, 160)
        : e instanceof Error ? e.message : String(e);
      setMessage({ text: `Erro ao carregar: ${text}`, kind: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.putSupportSettings({ faqItems: items });
      setSettings(saved);
      setItems(saved.faqItems);
      setMessage({ text: "FAQ salvo com sucesso.", kind: "ok" });
    } catch (e) {
      const text = e instanceof DashboardHttpError
        ? e.responseBody.slice(0, 160)
        : e instanceof Error ? e.message : String(e);
      setMessage({ text: `Erro ao salvar: ${text}`, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  function updateItem(id: string, field: "question" | "answer", val: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: val } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function updateTicketStatus(ticketId: string, status: SupportTicketStatus) {
    setTicketBusy(ticketId);
    setMessage(null);
    try {
      const updated = await api.patchSupportTicketStatus(ticketId, status);
      setTickets((prev) => prev.map((ticket) => (ticket.id === ticketId ? updated : ticket)));
      setMessage({ text: "Chamado atualizado.", kind: "ok" });
    } catch (e) {
      const text = e instanceof DashboardHttpError
        ? e.responseBody.slice(0, 160)
        : e instanceof Error ? e.message : String(e);
      setMessage({ text: `Erro ao atualizar chamado: ${text}`, kind: "error" });
    } finally {
      setTicketBusy(null);
    }
  }

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Atendimento ao Comprador</h1>
            <p className="page-lead">Login necessário para configurar o atendimento.</p>
          </div>
        </header>
      </div>
    );
  }

  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter((t) => t.status === "in_progress").length;

  return (
    <div className="dashboard-content">
      {/* ── Page Head ── */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Atendimento</span>
          <h1>Atendimento ao Comprador</h1>
          <p className="page-lead">
            Configure o atendimento ao comprador durante o checkout.
            {settings?.updatedAt ? (
              <> · FAQ atualizado em{" "}
                <span style={{ fontFamily: "var(--font-data)", fontSize: 12 }}>
                  {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(settings.updatedAt))}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => void load()}>
            <RefreshCw size={14} /> Atualizar
          </Button>
          <Button variant="primary" size="sm" arrow disabled={busy || !settings} loading={busy} onClick={() => void save()}>
            <Save size={14} /> Salvar FAQ
          </Button>
        </div>
      </header>

      {/* ── Message ── */}
      {message ? (
        <div
          className={`panel ${message.kind === "error" ? "panel-error" : "panel-info"}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            marginBottom: "var(--space-4)",
          }}
        >
          {message.kind === "error" ? (
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          ) : (
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
          )}
          {message.text}
        </div>
      ) : null}

      {/* ── Loading skeleton ── */}
      {loading && !settings ? <SupportSkeleton /> : null}

      {/* ── Ticket summary strip ── */}
      {!loading && tickets.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "var(--space-3)",
            marginBottom: "var(--space-5)",
          }}
        >
          <div className="metric">
            <span>Total de chamados</span>
            <strong>{tickets.length}</strong>
          </div>
          <div className="metric">
            <span>Em aberto</span>
            <strong style={{ color: openCount > 0 ? "var(--color-warning)" : undefined }}>
              {openCount}
            </strong>
          </div>
          <div className="metric">
            <span>Em atendimento</span>
            <strong style={{ color: inProgressCount > 0 ? "var(--color-info)" : undefined }}>
              {inProgressCount}
            </strong>
          </div>
        </div>
      ) : null}

      {settings ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {/* ── Hours Section ── */}
          <section className="panel stacked">
            <div className="panel-title">
              <h2>Horário de atendimento</h2>
            </div>
            <p className="page-lead" style={{ margin: 0, fontSize: 12 }}>Quando o suporte humano está disponível</p>
          </section>

          {/* ── FAQ Section ── */}
          <section className="panel stacked">
            <div className="panel-title">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-brand-subtle)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-brand)",
                    flexShrink: 0,
                  }}
                >
                  <HelpCircle size={15} />
                </div>
                <h2>Resposta automática</h2>
              <p className="page-lead" style={{ margin: 0, fontSize: 12 }}>Mensagem exibida fora do horário de atendimento</p>
              </div>
              <span className={`badge ${items.length > 0 ? "ok" : "muted"}`}>
                {items.length}/{20} itens
              </span>
            </div>

            {items.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <MessageSquare size={20} />
                </div>
                <h3>Nenhuma pergunta cadastrada</h3>
                <p>
                  Adicione perguntas frequentes para que o agente responda automaticamente
                  no checkout sem acionar o handoff humano.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setItems([newItem()])}
                >
                  <Plus size={14} />
                  Adicionar primeira pergunta
                </button>
              </div>
            ) : null}

            {items.map((item, idx) => (
              <div
                key={item.id}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-surface-raised)",
                  overflow: "hidden",
                }}
              >
                {/* FAQ item header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "var(--space-3) var(--space-4)",
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 22,
                        height: 22,
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-brand-subtle)",
                        color: "var(--color-brand)",
                        fontFamily: "var(--font-data)",
                        fontSize: 11,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      {item.question ? item.question.slice(0, 60) + (item.question.length > 60 ? "…" : "") : "Pergunta sem título"}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeItem(item.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      color: "var(--color-error)",
                      background: "transparent",
                      border: "1px solid transparent",
                      borderRadius: "var(--radius-sm)",
                      padding: "4px var(--space-2)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: busy ? "not-allowed" : "pointer",
                      minHeight: "unset",
                    }}
                  >
                    <Trash2 size={12} />
                    Remover
                  </button>
                </div>

                {/* FAQ item body */}
                <div
                  style={{
                    display: "grid",
                    gap: "var(--space-3)",
                    padding: "var(--space-4)",
                  }}
                >
                  <label>
                    Pergunta do comprador
                    <input
                      type="text"
                      value={item.question}
                      maxLength={200}
                      disabled={busy}
                      placeholder="Ex: Qual o prazo de entrega?"
                      onChange={(e) => updateItem(item.id, "question", e.target.value)}
                    />
                  </label>

                  <label>
                    Resposta sugerida
                    <textarea
                      value={item.answer}
                      maxLength={1000}
                      rows={3}
                      disabled={busy}
                      placeholder="Ex: Entregamos em 5-10 dias úteis para todo Brasil."
                      onChange={(e) => updateItem(item.id, "answer", e.target.value)}
                      style={{
                        width: "100%",
                        fontFamily: "var(--font-sans)",
                        fontSize: 13,
                        padding: "8px 12px",
                        border: "1px solid var(--color-border-strong)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-surface)",
                        color: "var(--color-text)",
                        resize: "vertical",
                        lineHeight: 1.5,
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}

            {settings && items.length > 0 && items.length < 20 ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setItems((prev) => [...prev, newItem()])}
                style={{ alignSelf: "flex-start" }}
              >
                <Plus size={14} />
                Adicionar pergunta
              </button>
            ) : null}

            {items.length >= 20 ? (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-muted)",
                  fontStyle: "italic",
                }}
              >
                Limite de 20 perguntas atingido.
              </p>
            ) : null}
          </section>

          {/* ── Tickets Section ── */}
          <section className="panel stacked">
            <div className="panel-title">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-brand-subtle)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-brand)",
                    flexShrink: 0,
                  }}
                >
                  <Ticket size={15} />
                </div>
                <h2>Escalonamento</h2>
              <p className="page-lead" style={{ margin: 0, fontSize: 12 }}>Encaminhe conversas para seu time quando necessário</p>
                <span
                  className="badge muted"
                  style={{ fontFamily: "var(--font-data)", fontSize: 11 }}
                >
                  {tickets.length}
                </span>
              </div>

              {/* Status filter */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
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
            </div>

            {tickets.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Ticket size={20} />
                </div>
                <h3>Nenhum chamado</h3>
                <p>
                  {ticketStatusFilter === "all"
                    ? "Nenhum chamado de suporte criado por handoff até o momento."
                    : `Nenhum chamado com status "${SUPPORT_STATUS_LABELS[ticketStatusFilter as SupportTicketStatus]}".`}
                </p>
              </div>
            ) : null}

            {tickets.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {tickets.map((ticket) => (
                  <article
                    key={ticket.id}
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
                    }}
                  >
                    {/* Ticket info */}
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                        <span
                          className={`status-dot ${STATUS_DOT[ticket.status]}`}
                          aria-hidden="true"
                        />
                        <span className={`badge ${STATUS_BADGE[ticket.status]}`}>
                          {SUPPORT_STATUS_LABELS[ticket.status]}
                        </span>
                        <code
                          style={{
                            fontFamily: "var(--font-data)",
                            fontSize: 11,
                            color: "var(--color-text-faint)",
                          }}
                        >
                          {ticket.id.slice(0, 8)}…
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
                        {ticket.createdAt}
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
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
