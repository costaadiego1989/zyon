import React, { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import type {
  SupportFaqItem,
  SupportSettings,
  SupportTicket,
  SupportTicketStatus
} from "@aacp/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile as MerchantMeProfile } from "../api-client.js";

function newItem(): SupportFaqItem {
  return { id: crypto.randomUUID(), question: "", answer: "" };
}

const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Aberto",
  in_progress: "Em atendimento",
  resolved: "Resolvido",
  closed: "Fechado"
};

const SUPPORT_STATUSES = Object.keys(SUPPORT_STATUS_LABELS) as SupportTicketStatus[];

export function SupportSettingsPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [items, setItems] = useState<SupportFaqItem[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<SupportTicketStatus | "all">("all");
  const [busy, setBusy] = useState(false);
  const [ticketBusy, setTicketBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    setMessage(null);
    try {
      const [s, t] = await Promise.all([
        api.getSupportSettings(),
        api.getSupportTickets(ticketStatusFilter === "all" ? undefined : ticketStatusFilter)
      ]);
      setSettings(s);
      setItems(s.faqItems);
      setTickets(t);
    } catch (e) {
      const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
      setMessage(`Erro ao carregar: ${text}`);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.putSupportSettings({ faqItems: items });
      setSettings(saved);
      setItems(saved.faqItems);
      setMessage("Salvo com sucesso.");
    } catch (e) {
      const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
      setMessage(`Erro ao salvar: ${text}`);
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
      setMessage("Chamado atualizado.");
    } catch (e) {
      const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
      setMessage(`Erro ao atualizar chamado: ${text}`);
    } finally {
      setTicketBusy(null);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Suporte - FAQ e chamados</h1>
        <p className="page-lead">Login necessário para gerenciar FAQ do suporte.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Suporte - FAQ e chamados</h1>
          <p className="page-lead">Perguntas frequentes do widget e chamados criados por handoff.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={busy || !settings} onClick={() => void save()}>
            <Save size={16} />
            Salvar FAQ
          </button>
          <button type="button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      {!settings && !message ? <p>Carregando…</p> : null}
      {settings ? (
        <div className="panel stacked">
          {items.length === 0 ? (
            <p style={{ color: "var(--text-muted, #888)" }}>Nenhuma pergunta cadastrada.</p>
          ) : null}
          {items.map((item, idx) => (
            <div key={item.id} className="panel stacked">
              <strong style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)" }}>#{idx + 1}</strong>
              <label>
                Pergunta
                <input
                  type="text"
                  value={item.question}
                  maxLength={200}
                  disabled={busy}
                  placeholder="ex: Qual o prazo de entrega?"
                  onChange={(e) => updateItem(item.id, "question", e.target.value)}
                />
              </label>
              <label>
                Resposta
                <textarea
                  value={item.answer}
                  maxLength={1000}
                  rows={3}
                  disabled={busy}
                  placeholder="ex: Entregamos em 5-10 dias úteis para todo Brasil."
                  onChange={(e) => updateItem(item.id, "answer", e.target.value)}
                />
              </label>
              <button
                type="button"
                style={{ alignSelf: "flex-start" }}
                disabled={busy}
                onClick={() => removeItem(item.id)}
              >
                <Trash2 size={14} />
                Remover
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={busy || items.length >= 20}
            onClick={() => setItems((prev) => [...prev, newItem()])}
          >
            <Plus size={14} />
            Adicionar pergunta {items.length >= 20 ? "(máx. 20)" : ""}
          </button>
          {settings.updatedAt ? (
            <p className="mono-small">Atualizado em {settings.updatedAt}</p>
          ) : null}
        </div>
      ) : null}
      <section className="panel stacked" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h2>Chamados</h2>
          <label style={{ minWidth: 220 }}>
            Status
            <select
              value={ticketStatusFilter}
              onChange={(event) => setTicketStatusFilter(event.target.value as SupportTicketStatus | "all")}
            >
              <option value="all">Todos</option>
              {SUPPORT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SUPPORT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {tickets.length === 0 ? (
          <p style={{ color: "var(--text-muted, #888)" }}>Nenhum chamado encontrado.</p>
        ) : null}
        {tickets.map((ticket) => (
          <article key={ticket.id} className="support-ticket-row">
            <div>
              <strong>{ticket.id}</strong>
              <p>{ticket.buyerMessage}</p>
              <p className="mono-small">
                {ticket.sessionId ? `Sessao ${ticket.sessionId} - ` : ""}
                Criado em {ticket.createdAt}
              </p>
            </div>
            <label>
              Status
              <select
                value={ticket.status}
                disabled={ticketBusy === ticket.id}
                onChange={(event) =>
                  void updateTicketStatus(ticket.id, event.target.value as SupportTicketStatus)
                }
              >
                {SUPPORT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {SUPPORT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </article>
        ))}
      </section>
    </>
  );
}
